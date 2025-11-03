"""closure_ts_compile runs tsickle over input srcs"""

load("@bazel_skylib//lib:paths.bzl", "paths")

ClosureTsCompileInfo = provider(doc = "info about a closure ts compile rule", fields = {
    "direct_srcs": "DepSet<File>: direct sources",
    "transitive_srcs": "DepSet<File>: transitive sources",
    "direct_outs": "DepSet<File>: direct outputs",
    "transitive_outs": "DepSet<File>: transitive outputs",
})

def _output_for_ts_input(ctx, src):
    filename = paths.replace_extension(src.basename, ".js")
    return ctx.actions.declare_file(filename, sibling = src)

def _output_for_externs(ctx):
    return ctx.actions.declare_file(ctx.label.name + ".externs.js")

def _closure_ts_compile_impl(ctx):
    direct_srcs = ctx.files.srcs
    transitive_srcs = [dep[ClosureTsCompileInfo].transitive_srcs for dep in ctx.attr.deps]
    transitive_outs = [dep[ClosureTsCompileInfo].transitive_outs for dep in ctx.attr.deps]

    args = ctx.actions.args()
    args.add_all(direct_srcs)

    env = {
        "BAZEL_BINDIR": ctx.bin_dir.path,
        "BAZEL_PACKAGE": ctx.label.package,
    }

    direct_ts = []
    direct_dts = []
    for src in direct_srcs:
        if src.basename.endswith(".d.ts"):
            direct_dts.append(src)
        else:
            direct_ts.append(src)

    direct_outs = [_output_for_ts_input(ctx, f) for f in direct_ts]
    if len(direct_dts) > 0:
        externs_output = _output_for_externs(ctx)
        direct_outs.append(externs_output)
        env["EXTERNS_PATH"] = externs_output.short_path.replace("../", "external/")

    all_srcs = depset(direct = direct_srcs, transitive = transitive_srcs)
    all_outs = depset(direct = direct_outs, transitive = transitive_outs)

    ctx.actions.run(
        mnemonic = "TsickleCompile",
        executable = ctx.executable._compiler,
        arguments = [args],
        inputs = all_srcs,
        outputs = direct_outs,
        env = env,
    )

    return [
        DefaultInfo(
            files = depset(direct_outs),
        ),
        ClosureTsCompileInfo(
            direct_srcs = direct_srcs,
            transitive_srcs = all_srcs,
            direct_outs = depset(direct_outs),
            transitive_outs = all_outs,
        ),
    ]

closure_ts_compile = rule(
    implementation = _closure_ts_compile_impl,
    attrs = {
        "srcs": attr.label_list(
            doc = "list of .ts files",
            allow_files = True,
            mandatory = True,
        ),
        "deps": attr.label_list(
            doc = "list of ClosureTsCompileInfo dependencies",
            providers = [ClosureTsCompileInfo],
        ),
        "_compiler": attr.label(
            default = "//tools/tsicklecompiler",
            doc = "the tsickle driver tool",
            executable = True,
            cfg = "exec",
        ),
    },
    provides = [ClosureTsCompileInfo],
)
