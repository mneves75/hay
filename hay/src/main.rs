#![forbid(unsafe_code)]

fn main() -> std::process::ExitCode {
    hay::run(std::env::args_os().skip(1).collect())
}
