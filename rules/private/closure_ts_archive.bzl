"""closure_ts_archive builds zip files of closure js sources"""

load(":closure_ts_compile.bzl", "ClosureTsCompileInfo")

def _get_zip_runfiles_path(path):
    if path.startswith("../"):
        parts = path.split("/")
        path = "/".join(parts[2:])
    return path

def _zip_action(ctx):
    srcs = ctx.files.srcs

    transitive_outs = [dep[ClosureTsCompileInfo].transitive_outs for dep in ctx.attr.deps]
    direct_outs = [dep[ClosureTsCompileInfo].direct_outs for dep in ctx.attr.deps]
    if ctx.attr.transitive:
        inputs = depset(srcs, transitive = transitive_outs)
    else:
        inputs = depset(srcs, transitive = direct_outs)

    def map_zip_runfiles(file):
        return "{}={}".format(
            _get_zip_runfiles_path(file.short_path),
            file.path,
        )

    manifest = ctx.actions.args()
    manifest.use_param_file("@%s", use_always = True)
    manifest.set_param_file_format("multiline")
    manifest.add_all(inputs, map_each = map_zip_runfiles, allow_closure = True)

    zip_cli_args = ctx.actions.args()
    zip_cli_args.add("cC")
    zip_cli_args.add(ctx.outputs.zip)

    ctx.actions.run(
        executable = ctx.executable._zipper,
        arguments = [zip_cli_args, manifest],
        inputs = inputs,
        outputs = [ctx.outputs.zip],
        use_default_shell_env = True,
        mnemonic = "ClosureTsZip",
        progress_message = "Building zip: %{label}",
    )

def _closure_ts_archive_impl(ctx):
    _zip_action(ctx)

    return [
        DefaultInfo(
            files = depset([ctx.outputs.zip]),
        ),
    ]

closure_ts_archive = rule(
    implementation = _closure_ts_archive_impl,
    attrs = {
        "srcs": attr.label_list(
            doc = "additional sources to add to the archive",
            allow_files = True,
        ),
        "deps": attr.label_list(
            doc = "closure ts compile dependencies to archive",
            providers = [ClosureTsCompileInfo],
        ),
        "transitive": attr.bool(
            doc = "archive transitive dependencies into a single archive",
        ),
        "_zipper": attr.label(
            cfg = "exec",
            executable = True,
            default = "@bazel_tools//tools/zip:zipper",
        ),
    },
    outputs = {
        "zip": "%{name}.js.zip",
    },
)
