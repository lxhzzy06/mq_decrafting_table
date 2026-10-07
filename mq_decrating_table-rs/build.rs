fn main() {
    // mimalloc-sys 在 Windows 上依赖 advapi32 提供的 token 相关符号。
    // 放在构建脚本里声明而不是 .cargo/config.toml, 这样无论 cargo 从哪个目录被调用都能生效。
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        println!("cargo:rustc-link-lib=advapi32");
    }
}
