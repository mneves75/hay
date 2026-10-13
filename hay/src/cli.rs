#![forbid(unsafe_code)]

use std::{ffi::OsString, io::Write, process::ExitCode};

pub(crate) fn entry(args: Vec<OsString>) -> ExitCode {
    match mode(&args) {
        Ok(Some("mcp")) => match mcp_roots(args).and_then(|roots| {
            tokio::runtime::Builder::new_multi_thread()
                .worker_threads(2)
                .enable_all()
                .build()
                .map_err(|e| e.to_string())?
                .block_on(crate::mcp::serve(roots))
        }) {
            Ok(()) => ExitCode::SUCCESS,
            Err(error) => fail(error),
        },
        Ok(Some("find")) => match crate::finder::parse_cli(args).and_then(|(request, json)| {
            let response = crate::finder::find(&request)?;
            let mut out = std::io::stdout().lock();
            if json {
                serde_json::to_writer(&mut out, &crate::find_json(&response))
                    .map_err(|e| e.to_string())?;
                writeln!(out).map_err(|e| e.to_string())?;
            } else {
                for hit in &response.hits {
                    out.write_all(&crate::engine::path_bytes(&hit.path))
                        .map_err(|e| e.to_string())?;
                    writeln!(out).map_err(|e| e.to_string())?;
                }
            }
            for error in &response.errors {
                eprintln!("hay: {error}");
            }
            Ok(if !response.complete {
                2
            } else if response.total == 0 {
                1
            } else {
                0
            })
        }) {
            Ok(code) => ExitCode::from(code),
            Err(error) => fail(error),
        },
        Ok(_) => crate::engine::entry(args),
        Err(error) => fail(error),
    }
}

fn fail(error: String) -> ExitCode {
    eprintln!("hay: {error}");
    ExitCode::from(2)
}

// Detect actual options, never a pattern after -- or a value consumed by -e/-g/etc.
fn mode(args: &[OsString]) -> Result<Option<&'static str>, String> {
    use lexopt::prelude::*;
    let mut parser = lexopt::Parser::from_args(args.iter().cloned());
    while let Some(arg) = parser.next().map_err(|e| e.to_string())? {
        match arg {
            // These already exited before later arguments in the original parser.
            Short('h' | 'V') | Long("help" | "version" | "type-list") => return Ok(None),
            Long("find") => return Ok(Some("find")),
            Long("mcp") => return Ok(Some("mcp")),
            Short('e' | 'g' | 't' | 'T' | 'A' | 'B' | 'C' | 'm')
            | Long(
                "regexp" | "glob" | "type" | "type-not" | "after-context" | "before-context"
                | "context" | "max-count",
            ) => {
                parser.value().map_err(|e| e.to_string())?;
            }
            _ => {}
        }
    }
    Ok(None)
}

fn mcp_roots(args: Vec<OsString>) -> Result<Vec<std::path::PathBuf>, String> {
    use lexopt::prelude::*;
    let mut roots = Vec::new();
    let mut mode = false;
    let mut parser = lexopt::Parser::from_args(args);
    while let Some(arg) = parser.next().map_err(|e| e.to_string())? {
        match arg {
            Long("mcp") if !mode => mode = true,
            Long("root") => roots.push(parser.value().map_err(|e| e.to_string())?.into()),
            _ => return Err("--mcp accepts only explicit --root repositories".into()),
        }
    }
    Ok(roots)
}
