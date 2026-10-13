//! Stdio-only, bounded adapter over live retrieval. Registered scopes are not an OS sandbox.
use rmcp::{
    ErrorData, RoleServer, ServerHandler, ServiceExt,
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::{CallToolResult, ContentBlock, Implementation, ServerCapabilities, ServerConfig},
    service::RequestContext,
    tool, tool_handler, tool_router,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::{
    ffi::OsString,
    io,
    path::PathBuf,
    pin::Pin,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    task::{Context, Poll},
};
use tokio::io::{AsyncRead, ReadBuf};

const FRAME_BYTES: usize = 1024 * 1024;
const ARGUMENT_BYTES: usize = 128 * 1024;
const RESPONSE_BYTES: usize = 8 * 1024 * 1024;
fn default_limit() -> usize {
    50
}

#[derive(Clone, Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct GrepRequest {
    root: String,
    pattern: String,
    #[serde(default)]
    fixed: bool,
    #[serde(default)]
    ignore_case: bool,
    #[serde(default)]
    whole_word: bool,
    #[serde(default)]
    hidden: bool,
    #[serde(default)]
    no_ignore: bool,
    #[serde(default)]
    globs: Vec<String>,
    #[serde(default)]
    types: Vec<String>,
    #[serde(default)]
    types_not: Vec<String>,
    #[serde(default)]
    context: usize,
    #[serde(default = "default_limit")]
    limit: usize,
}

#[derive(Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct FindRequest {
    root: String,
    query: String,
    #[serde(default)]
    globs: Vec<String>,
    #[serde(default)]
    types: Vec<String>,
    #[serde(default)]
    types_not: Vec<String>,
    #[serde(default)]
    hidden: bool,
    #[serde(default)]
    no_ignore: bool,
    #[serde(default)]
    ignore_case: bool,
    #[serde(default)]
    exact: bool,
    #[serde(default = "default_limit")]
    limit: usize,
    size: Option<String>,
    mtime: Option<String>,
    git: Option<String>,
}

#[derive(Deserialize, Serialize, JsonSchema)]
#[serde(deny_unknown_fields)]
struct MultiRequest {
    queries: Vec<GrepRequest>,
}

#[derive(Clone)]
struct HayMcp {
    roots: Arc<Vec<PathBuf>>,
    permits: Arc<tokio::sync::Semaphore>,
    tool_router: ToolRouter<Self>,
}

/// Bound lines before the SDK's NDJSON decoder grows its input buffer.
struct FrameReader<R> {
    inner: R,
    bytes: usize,
    exceeded: Arc<AtomicBool>,
}
impl<R: AsyncRead + Unpin> AsyncRead for FrameReader<R> {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<io::Result<()>> {
        let start = buf.filled().len();
        match Pin::new(&mut self.inner).poll_read(cx, buf) {
            Poll::Ready(Ok(())) => {
                for byte in &buf.filled()[start..] {
                    self.bytes += 1;
                    if self.bytes > FRAME_BYTES {
                        self.exceeded.store(true, Ordering::Relaxed);
                        return Poll::Ready(Err(io::Error::other("MCP input frame exceeds 1 MiB")));
                    }
                    if *byte == b'\n' {
                        self.bytes = 0;
                    }
                }
                Poll::Ready(Ok(()))
            }
            other => other,
        }
    }
}

/// Cancellation keeps the permit inside the job until that job actually stops.
struct CancelWatch {
    signal: Arc<AtomicBool>,
    task: tokio::task::JoinHandle<()>,
}
impl CancelWatch {
    fn new(context: RequestContext<RoleServer>) -> Self {
        let signal = Arc::new(AtomicBool::new(false));
        let worker = signal.clone();
        let task = tokio::spawn(async move {
            context.ct.cancelled().await;
            worker.store(true, Ordering::Relaxed);
        });
        Self { signal, task }
    }
}
impl Drop for CancelWatch {
    fn drop(&mut self) {
        self.signal.store(true, Ordering::Relaxed);
        self.task.abort();
    }
}

fn checked_request(request: &impl Serialize, limit: usize) -> Result<(), String> {
    if limit == 0 || limit > 1000 {
        return Err("MCP limit must be 1..=1000; use the CLI for unlimited output".into());
    }
    if serde_json::to_vec(request)
        .map_err(|e| e.to_string())?
        .len()
        > ARGUMENT_BYTES
    {
        return Err("MCP arguments exceed 128 KiB".into());
    }
    Ok(())
}

fn root_in_scope(root: &str, roots: &[PathBuf]) -> Result<PathBuf, String> {
    let canonical = PathBuf::from(root)
        .canonicalize()
        .map_err(|e| format!("search root: {e}"))?;
    if !canonical.is_dir() || !roots.iter().any(|r| canonical.starts_with(r)) {
        return Err("search root is outside the explicitly registered repositories".into());
    }
    Ok(canonical)
}

fn failure(error: impl ToString) -> serde_json::Value {
    serde_json::json!({"events":[],"exit_code":2,"complete":false,"diagnostic":error.to_string()})
}

fn result(payload: serde_json::Value) -> CallToolResult {
    let failed = payload["complete"] == false
        || payload["exit_code"] == 2
        || payload["results"]
            .as_array()
            .is_some_and(|r| r.iter().any(|r| r["complete"] == false));
    let bytes = match serde_json::to_vec(&payload) {
        Ok(bytes) if bytes.len() <= RESPONSE_BYTES => bytes,
        _ => {
            return result(failure(
                "MCP response byte budget exceeded; results incomplete",
            ));
        }
    };
    let content = vec![ContentBlock::text(
        String::from_utf8_lossy(&bytes).into_owned(),
    )];
    let mut response = if failed {
        CallToolResult::error(content)
    } else {
        CallToolResult::success(content)
    };
    response.structured_content = Some(payload);
    response
}

fn grep_payload(
    request: GrepRequest,
    roots: &[PathBuf],
    signal: Arc<AtomicBool>,
) -> Result<serde_json::Value, String> {
    checked_request(&request, request.limit)?;
    if request.context > 100
        || request.pattern.len() > 65536
        || request.globs.len() + request.types.len() + request.types_not.len() > 128
    {
        return Err("MCP request exceeds context/pattern/filter budget".into());
    }
    let root = root_in_scope(&request.root, roots)?;
    let mut args: Vec<OsString> = vec![
        "--json".into(),
        "-e".into(),
        request.pattern.into(),
        "-m".into(),
        request.limit.to_string().into(),
    ];
    for (enabled, flag) in [
        (request.fixed, "-F"),
        (request.ignore_case, "-i"),
        (request.whole_word, "-w"),
        (request.hidden, "--hidden"),
        (request.no_ignore, "--no-ignore"),
    ] {
        if enabled {
            args.push(flag.into());
        }
    }
    for (flag, values) in [
        ("-g", request.globs),
        ("-t", request.types),
        ("-T", request.types_not),
    ] {
        for value in values {
            args.push(flag.into());
            args.push(value.into());
        }
    }
    if request.context > 0 {
        args.push("-C".into());
        args.push(request.context.to_string().into());
    }
    args.push("--".into());
    args.push(root.into_os_string());
    let response = crate::engine::search(args, signal)?;
    Ok(
        serde_json::json!({"events":response.events,"exit_code":response.exit_code,
        "complete":response.exit_code!=2,"diagnostic":response.diagnostic,"page_limit":request.limit,
        "page_truncated":response.page_truncated,"total_matches":response.total_matches}),
    )
}

#[tool_router]
impl HayMcp {
    fn new(roots: Vec<PathBuf>) -> Self {
        Self {
            roots: Arc::new(roots),
            permits: Arc::new(tokio::sync::Semaphore::new(1)),
            tool_router: Self::tool_router(),
        }
    }

    #[tool(
        description = "Search live content with hay's matcher/ranking. No query rewriting. complete describes the search; page_truncated describes the requested page. Registered roots are search scopes, not an OS sandbox."
    )]
    async fn grep(
        &self,
        Parameters(request): Parameters<GrepRequest>,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let permit = match self.permits.clone().try_acquire_owned() {
            Ok(p) => p,
            Err(_) => {
                return Ok(result(failure(
                    "search service is busy; retry after the current search",
                )));
            }
        };
        let watch = CancelWatch::new(context);
        let signal = watch.signal.clone();
        let roots = self.roots.clone();
        let payload = tokio::task::spawn_blocking(move || {
            let _permit = permit;
            grep_payload(request, &roots, signal).unwrap_or_else(failure)
        })
        .await
        .unwrap_or_else(failure);
        Ok(result(payload))
    }

    #[tool(
        description = "Find filenames in a live repository, with typo tolerance and explicit filters. complete and truncated describe different conditions."
    )]
    async fn find_files(
        &self,
        Parameters(request): Parameters<FindRequest>,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        let permit = match self.permits.clone().try_acquire_owned() {
            Ok(p) => p,
            Err(_) => {
                return Ok(result(failure(
                    "search service is busy; retry after the current search",
                )));
            }
        };
        let watch = CancelWatch::new(context);
        let signal = watch.signal.clone();
        let roots = self.roots.clone();
        let payload = tokio::task::spawn_blocking(move || {
            let _permit = permit;
            let search = || {
                checked_request(&request, request.limit)?;
                if request.query.len() > 4096
                    || request.globs.len() + request.types.len() + request.types_not.len() > 128
                {
                    return Err("filename request exceeds budget".into());
                }
                let root = root_in_scope(&request.root, &roots)?;
                let found = crate::finder::find_cancellable(
                    &crate::finder::FindRequest {
                        query: request.query,
                        root,
                        globs: request.globs,
                        types: request.types,
                        types_not: request.types_not,
                        hidden: request.hidden,
                        no_ignore: request.no_ignore,
                        ignore_case: request.ignore_case,
                        exact: request.exact,
                        limit: request.limit,
                        size: request.size,
                        mtime: request.mtime,
                        git: request.git,
                    },
                    Some(signal),
                )?;
                Ok::<_, String>(crate::find_json(&found))
            };
            search().unwrap_or_else(failure)
        })
        .await
        .unwrap_or_else(failure);
        Ok(result(payload))
    }

    #[tool(
        description = "Run 1..=32 independent live content searches. Each keeps its own ordering and completeness. No combined patterns or automatic retries."
    )]
    async fn multi_grep(
        &self,
        Parameters(request): Parameters<MultiRequest>,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResult, ErrorData> {
        if request.queries.is_empty() || request.queries.len() > 32 {
            return Ok(result(failure("multi_grep requires 1..=32 queries")));
        }
        if let Err(error) = checked_request(&request, 1) {
            return Ok(result(failure(error)));
        }
        let permit = match self.permits.clone().try_acquire_owned() {
            Ok(p) => p,
            Err(_) => {
                return Ok(result(failure(
                    "search service is busy; retry after the current search",
                )));
            }
        };
        let watch = CancelWatch::new(context);
        let signal = watch.signal.clone();
        let roots = self.roots.clone();
        let payload = tokio::task::spawn_blocking(move || {
            let _permit = permit;
            let mut results = Vec::new();
            let mut bytes = 0usize;
            for query in request.queries {
                if signal.load(Ordering::Relaxed) {
                    results.push(failure("search cancelled"));
                    continue;
                }
                if bytes >= RESPONSE_BYTES - 8192 {
                    results.push(failure(
                        "batch response byte budget exceeded; query not searched",
                    ));
                    continue;
                }
                let response = grep_payload(query, &roots, signal.clone()).unwrap_or_else(failure);
                let size = serde_json::to_vec(&response).map_or(RESPONSE_BYTES, |r| r.len());
                if bytes.saturating_add(size) > RESPONSE_BYTES - 8192 {
                    results.push(failure(
                        "batch response byte budget exceeded; query incomplete",
                    ));
                    bytes = RESPONSE_BYTES;
                } else {
                    bytes += size;
                    results.push(response);
                }
            }
            serde_json::json!({"results":results})
        })
        .await
        .unwrap_or_else(failure);
        Ok(result(payload))
    }
}

#[tool_handler(router=self.tool_router)]
impl ServerHandler for HayMcp {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new("hay",env!("CARGO_PKG_VERSION")))
            .with_instructions("Live searches, explicit registered scopes, no query rewriting/history. Scopes are not an OS sandbox against hostile concurrent filesystem mutation. Byte/resource failures are explicit. Cancellation is cooperative at file/match boundaries.")
    }
}

pub(crate) async fn serve(roots: Vec<PathBuf>) -> Result<(), String> {
    if roots.is_empty() {
        return Err("--mcp requires at least one --root repository".into());
    }
    let roots = roots
        .iter()
        .map(|r| crate::scope::repository(r))
        .collect::<Result<Vec<_>, _>>()?;
    let exceeded = Arc::new(AtomicBool::new(false));
    let input = FrameReader {
        inner: tokio::io::stdin(),
        bytes: 0,
        exceeded: exceeded.clone(),
    };
    let service = HayMcp::new(roots)
        .serve((input, tokio::io::stdout()))
        .await
        .map_err(|e| e.to_string())?;
    service.waiting().await.map_err(|e| e.to_string())?;
    if exceeded.load(Ordering::Relaxed) {
        return Err("MCP input frame limit exceeded".into());
    }
    Ok(())
}
