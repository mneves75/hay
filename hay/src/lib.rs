#![forbid(unsafe_code)]

//! Shared retrieval engine; ordinary CLI searches remain stateless.

mod cli;
mod engine;
mod finder;
mod mcp;
mod scope;
mod score;
mod walk;

/// Run the CLI. Retrieval implementation details are intentionally not a public API.
pub fn run(args: Vec<std::ffi::OsString>) -> std::process::ExitCode {
    cli::entry(args)
}

fn find_json(response: &finder::FindResponse) -> serde_json::Value {
    serde_json::json!({
        "hits": response.hits.iter().map(|hit| serde_json::json!({
            "path": engine::json_path(&hit.path), "size": hit.size,
            "modified": hit.modified, "git_status": hit.git_status
        })).collect::<Vec<_>>(),
        "total": response.total, "complete": response.complete, "errors": response.errors,
        "truncated": response.total > response.hits.len()
    })
}
