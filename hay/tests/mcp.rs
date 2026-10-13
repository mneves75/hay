use assert_cmd::prelude::*;
use std::{
    fs,
    io::{BufRead, BufReader, Write},
    process::{Command, Stdio},
};

// A failed assertion must not leave a live MCP child behind. Replies have a timeout so
// a protocol regression fails this test instead of hanging the entire test runner.
struct Client {
    child: std::process::Child,
    input: Option<std::process::ChildStdin>,
    replies: std::sync::mpsc::Receiver<serde_json::Value>,
    next_id: u64,
}
impl Client {
    fn start(root: &std::path::Path) -> Self {
        let mut child = Command::cargo_bin("hay")
            .unwrap()
            .args(["--mcp", "--root"])
            .arg(root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let input = child.stdin.take();
        let output = child.stdout.take().unwrap();
        let (send, replies) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(output).lines() {
                let Ok(line) = line else { break };
                let Ok(value) = serde_json::from_str(&line) else {
                    break;
                };
                if send.send(value).is_err() {
                    break;
                }
            }
        });
        let mut client = Self {
            child,
            input,
            replies,
            next_id: 1,
        };
        let response = client.request(
            "initialize",
            serde_json::json!({
                "protocolVersion":"2025-11-25","capabilities":{},
                "clientInfo":{"name":"hay-test","version":"1"}
            }),
        );
        assert!(response["result"].is_object(), "{response}");
        client.send(serde_json::json!({"jsonrpc":"2.0","method":"notifications/initialized"}));
        client
    }
    fn send(&mut self, value: serde_json::Value) {
        writeln!(self.input.as_mut().unwrap(), "{value}").unwrap();
    }
    fn request(&mut self, method: &str, params: serde_json::Value) -> serde_json::Value {
        let id = self.next_id;
        self.next_id += 1;
        self.send(serde_json::json!({"jsonrpc":"2.0","id":id,"method":method,"params":params}));
        let response = self
            .replies
            .recv_timeout(std::time::Duration::from_secs(10))
            .expect("MCP must reply within 10 seconds for these small fixtures");
        assert_eq!(response["id"], id);
        response
    }
    fn call(&mut self, name: &str, arguments: serde_json::Value) -> serde_json::Value {
        let reply = self.request(
            "tools/call",
            serde_json::json!({"name":name,"arguments":arguments}),
        );
        assert!(reply["result"].is_object(), "{reply}");
        let payload: serde_json::Value =
            serde_json::from_str(reply["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
        assert_eq!(payload, reply["result"]["structuredContent"]);
        payload
    }
    fn finish(mut self) {
        self.input.take();
        let start = std::time::Instant::now();
        loop {
            if let Some(exit) = self.child.try_wait().unwrap() {
                assert!(exit.success(), "{exit}");
                return;
            }
            assert!(
                start.elapsed() < std::time::Duration::from_secs(5),
                "MCP must exit after EOF"
            );
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
    }
}
impl Drop for Client {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[test]
fn live_filename_search_and_batch_failures_are_independent() {
    let d = repository();
    fs::create_dir(d.path().join("src")).unwrap();
    fs::write(
        d.path().join("src/session.rs"),
        "fn validate_session() {}\n",
    )
    .unwrap();
    fs::write(d.path().join("other.rs"), "validate_session();\n").unwrap();
    let mut client = Client::start(d.path());
    let found = client.call(
        "find_files",
        serde_json::json!({
            "root":d.path(),"query":"sesison","globs":["src/*.rs"]
        }),
    );
    assert_eq!(found["complete"], true);
    assert_eq!(found["total"], 1);
    fs::rename(
        d.path().join("src/session.rs"),
        d.path().join("src/auth.rs"),
    )
    .unwrap();
    let found = client.call(
        "find_files",
        serde_json::json!({"root":d.path(),"query":"auth.rs","exact":true}),
    );
    assert_eq!(
        found["total"], 1,
        "rename must be visible without a restart"
    );
    fs::write(d.path().join("other.rs"), "fn fresh_value() {}\n").unwrap();
    let batch = client.call(
        "multi_grep",
        serde_json::json!({"queries":[
            {"root":d.path(),"pattern":"validate_session","globs":["src/*.rs"]},
            {"root":d.path(),"pattern":"fresh_value"},
            {"root":d.path(),"pattern":"not_present_anywhere"},
            {"root":d.path(),"pattern":"["}
        ]}),
    );
    assert_eq!(batch["results"].as_array().unwrap().len(), 4);
    assert_eq!(batch["results"][0]["exit_code"], 0);
    assert_eq!(batch["results"][0]["total_matches"], 1);
    assert_eq!(batch["results"][1]["exit_code"], 0);
    assert_eq!(batch["results"][2]["exit_code"], 1);
    assert_eq!(batch["results"][2]["complete"], true);
    assert_eq!(batch["results"][3]["exit_code"], 2);
    assert_eq!(batch["results"][3]["complete"], false);
    client.finish();
}

#[test]
fn tool_failures_and_invalid_arguments_keep_the_server_usable() {
    let d = repository();
    fs::write(d.path().join("ok.rs"), "fn positive_control() {}\n").unwrap();
    let mut client = Client::start(d.path());
    for (name, args) in [
        ("grep", serde_json::json!({"root":d.path(),"pattern":"["})),
        (
            "grep",
            serde_json::json!({"root":d.path(),"pattern":"ok","limit":0}),
        ),
        (
            "find_files",
            serde_json::json!({"root":d.path(),"query":"ok","size":"invalid"}),
        ),
        ("multi_grep", serde_json::json!({"queries":[]})),
    ] {
        let response = client.request(
            "tools/call",
            serde_json::json!({"name":name,"arguments":args}),
        );
        assert_eq!(response["result"]["isError"], true, "{response}");
        assert_eq!(response["result"]["structuredContent"]["exit_code"], 2);
    }
    let schema = client.request(
        "tools/call",
        serde_json::json!({"name":"grep","arguments":{
            "root":d.path(),"pattern":"ok","invented_flag":true
        }}),
    );
    // The official SDK reports a tool's parameter-deserialization failure as isError.
    assert_eq!(schema["result"]["isError"], true, "{schema}");
    assert!(
        schema["result"]["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("unknown field")
    );
    let ok = client.call(
        "grep",
        serde_json::json!({"root":d.path(),"pattern":"positive_control"}),
    );
    assert_eq!(ok["exit_code"], 0);
    client.finish();
}

#[test]
fn registered_scopes_reject_static_outside_paths() {
    let d = repository();
    let outside = repository();
    fs::write(outside.path().join("outside.rs"), "private_fixture\n").unwrap();
    let mut client = Client::start(d.path());
    for root in [
        outside.path().to_path_buf(),
        outside.path().join("outside.rs"),
    ] {
        let reply = client.call(
            "grep",
            serde_json::json!({"root":root,"pattern":"private_fixture"}),
        );
        assert_eq!(reply["exit_code"], 2);
        assert_eq!(reply["complete"], false);
        assert_eq!(reply["events"], serde_json::json!([]));
    }
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(outside.path(), d.path().join("escape")).unwrap();
        let reply = client.call(
            "find_files",
            serde_json::json!({"root":d.path().join("escape"),"query":"outside"}),
        );
        assert_eq!(reply["exit_code"], 2);
    }
    client.finish();
}

fn repository() -> tempfile::TempDir {
    let d = tempfile::tempdir().unwrap();
    Command::new("git")
        .args(["init", "-q"])
        .current_dir(d.path())
        .assert()
        .success();
    d
}

#[test]
fn mcp_rejects_oversized_frames_before_decoding_them() {
    let d = repository();
    let mut child = Command::cargo_bin("hay")
        .unwrap()
        .args(["--mcp", "--root"])
        .arg(d.path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let init = serde_json::json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{
        "protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"x".repeat(1024*1024),"version":"1"}}});
    let mut input = child.stdin.take().unwrap();
    let _ = writeln!(input, "{init}");
    drop(input);
    let output = child.wait_with_output().unwrap();
    assert!(
        !output.status.success(),
        "oversized frame must close the transport"
    );
}

#[test]
fn mcp_exposes_only_three_tools_and_matches_the_cli() {
    let d = tempfile::tempdir().unwrap();
    Command::new("git")
        .args(["init", "-q"])
        .current_dir(d.path())
        .status()
        .unwrap();
    fs::write(d.path().join("auth.rs"), "fn validate_session() {}\n").unwrap();
    let mut child = Command::cargo_bin("hay")
        .unwrap()
        .arg("--mcp")
        .arg("--root")
        .arg(d.path().canonicalize().unwrap())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .unwrap();
    let mut input = child.stdin.take().unwrap();
    let mut reader = BufReader::new(child.stdout.take().unwrap());
    let init = serde_json::json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{
        "protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"hay-test","version":"1"}}});
    writeln!(input, "{init}").unwrap();
    let mut line = String::new();
    assert!(
        reader.read_line(&mut line).unwrap() > 0,
        "server must answer initialize"
    );
    let value: serde_json::Value = serde_json::from_str(&line).unwrap();
    assert!(value.get("result").is_some(), "{value}");
    writeln!(
        input,
        "{}",
        serde_json::json!({"jsonrpc":"2.0","method":"notifications/initialized"})
    )
    .unwrap();
    writeln!(
        input,
        "{}",
        serde_json::json!({"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}})
    )
    .unwrap();
    line.clear();
    reader.read_line(&mut line).unwrap();
    let tools: serde_json::Value = serde_json::from_str(&line).unwrap();
    assert_eq!(tools["result"]["tools"].as_array().unwrap().len(), 3);
    let request = serde_json::json!({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{
        "name":"grep","arguments":{"pattern":"validate_session","root":d.path().to_str().unwrap()}}});
    writeln!(input, "{request}").unwrap();
    line.clear();
    reader.read_line(&mut line).unwrap();
    let response: serde_json::Value = serde_json::from_str(&line).unwrap();
    let payload: serde_json::Value =
        serde_json::from_str(response["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(payload["exit_code"], 0);
    assert_eq!(payload["complete"], true);
    let cli = Command::cargo_bin("hay")
        .unwrap()
        .args(["--json", "validate_session"])
        .arg(d.path().canonicalize().unwrap())
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let event: serde_json::Value = serde_json::from_slice(&cli).unwrap();
    assert_eq!(payload["events"][0], event);
    fs::write(d.path().join("second.rs"), "fn another() {}\n").unwrap();
    let page = serde_json::json!({"jsonrpc":"2.0","id":4,"method":"tools/call","params":{
        "name":"grep","arguments":{"pattern":"fn ","root":d.path().to_str().unwrap(),"limit":1}}});
    writeln!(input, "{page}").unwrap();
    line.clear();
    reader.read_line(&mut line).unwrap();
    let page: serde_json::Value = serde_json::from_str(&line).unwrap();
    let page: serde_json::Value =
        serde_json::from_str(page["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(page["complete"], true);
    assert_eq!(page["page_truncated"], true);
    assert_eq!(page["total_matches"], 2);
    fs::write(d.path().join("large.rs"), "x".repeat(8 * 1024 * 1024 + 1)).unwrap();
    let large = serde_json::json!({"jsonrpc":"2.0","id":5,"method":"tools/call","params":{
        "name":"grep","arguments":{"pattern":"x","fixed":true,"root":d.path().to_str().unwrap()}}});
    writeln!(input, "{large}").unwrap();
    line.clear();
    reader.read_line(&mut line).unwrap();
    let large: serde_json::Value = serde_json::from_str(&line).unwrap();
    let large: serde_json::Value =
        serde_json::from_str(large["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(large["complete"], false);
    assert_eq!(large["exit_code"], 2);
    drop(input);
    let status = child.wait().unwrap();
    assert!(status.success());
}
