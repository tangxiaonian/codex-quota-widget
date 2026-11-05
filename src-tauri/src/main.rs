#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() {
    if std::env::args().any(|a| a == "--read-only-check") {
        if let Err(error) = quota_widget::read_only_check() {
            eprintln!("{error}");
            std::process::exit(1);
        }
        return;
    }
    quota_widget::run();
}
