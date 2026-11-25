fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        cc::Build::new()
            .file("native/workspace.m")
            .file("native/top_hide.m")
            .file("native/subscription_http.m")
            .file("native/workbuddy_http.m")
            .file("native/quota_http.m")
            .file("native/antigravity_http.m")
            .flag("-fobjc-arc")
            .compile("workspace");
        println!("cargo:rustc-link-lib=framework=AppKit");
        println!("cargo:rustc-link-lib=framework=Foundation");
        println!("cargo:rustc-link-lib=framework=Security");
        println!("cargo:rerun-if-changed=native/workspace.m");
        println!("cargo:rerun-if-changed=native/top_hide.m");
        println!("cargo:rerun-if-changed=native/window.h");
        println!("cargo:rerun-if-changed=native/subscription_http.m");
        println!("cargo:rerun-if-changed=native/workbuddy_http.m");
        println!("cargo:rerun-if-changed=native/quota_http.m");
        println!("cargo:rerun-if-changed=native/quota_http.h");
        println!("cargo:rerun-if-changed=native/antigravity_http.m");
    }
    tauri_build::build()
}
