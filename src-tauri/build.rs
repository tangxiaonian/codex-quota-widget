fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        cc::Build::new()
            .file("native/workspace.m")
            .flag("-fobjc-arc")
            .compile("workspace");
        println!("cargo:rustc-link-lib=framework=AppKit");
        println!("cargo:rustc-link-lib=framework=Foundation");
        println!("cargo:rerun-if-changed=native/workspace.m");
    }
    tauri_build::build()
}
