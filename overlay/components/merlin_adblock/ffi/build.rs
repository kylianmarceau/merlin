fn main() {
    cxx_build::bridge("src/lib.rs")
        .std("c++20")
        .compile("merlin_adblock_ffi");
    println!("cargo:rerun-if-changed=src/lib.rs");
}
