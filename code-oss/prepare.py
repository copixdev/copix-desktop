#!/usr/bin/env python3
"""Turn a microsoft/vscode checkout (MIT) into the Copix 4.5.0 shell.

The checkout is not vendored. CI clones tag 1.141.0 and runs this script.
"""

from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

# Windows CI defaults to cp1252 and rewrites "\n" as CRLF. The vscode tree is UTF-8 with LF.
_read_text = Path.read_text
_write_text = Path.write_text


def _read_utf8(self: Path, encoding: str | None = None, errors: str | None = None) -> str:
    return _read_text(self, encoding="utf-8", errors=errors)


def _write_utf8(self: Path, data: str, encoding: str | None = None, errors: str | None = None, newline: str | None = None) -> int:
    return _write_text(self, data, encoding="utf-8", errors=errors, newline="\n")


Path.read_text = _read_utf8  # type: ignore[method-assign]
Path.write_text = _write_utf8  # type: ignore[method-assign]

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parent
VERSION = "4.5.0"

DELETE_PRODUCT_KEYS = (
    "defaultChatAgent",
    "agentsTelemetryAppName",
    "webviewContentExternalBaseUrlTemplate",
    "trustedExtensionAuthAccess",
    "onboardingKeymaps",
    "sessionsWindowAllowedExtensions",
    "voiceWsUrl",
)

# User-visible product names. Copyright lines are left alone.
REPLACEMENTS = (
    ("Visual Studio Code", "Copix"),
    ("VS Code", "Copix"),
    ("Code - OSS", "Copix"),
    ("Code OSS", "Copix"),
)

SKIP_DIR_NAMES = {
    ".git",
    "node_modules",
    "out",
    "out-build",
    "extensions/copilot",
}
SKIP_FILES = {
    "LICENSE.txt",
    "ThirdPartyNotices.txt",
    "package-lock.json",
    "yarn.lock",
}
TEXT_SUFFIXES = {
    ".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".html", ".css", ".md",
    ".svg", ".iss", ".xml", ".yml", ".yaml", ".txt", ".sh", ".desktop",
}


def require_anchor(text: str, anchor: str, label: str) -> str:
    if anchor not in text:
        raise SystemExit(f"{label} is missing the expected anchor:\n{anchor}")
    return text


def merge_product(src: Path) -> None:
    product_path = src / "product.json"
    product = json.loads(product_path.read_text(encoding="utf-8"))
    overlay = json.loads((ROOT / "product.overlay.json").read_text(encoding="utf-8"))
    for key in DELETE_PRODUCT_KEYS:
        product.pop(key, None)
    product.update(overlay)
    product["builtInExtensions"] = []
    product_path.write_text(json.dumps(product, indent="\t") + "\n")

    package_path = src / "package.json"
    package = json.loads(package_path.read_text(encoding="utf-8"))
    package["version"] = VERSION
    package_path.write_text(json.dumps(package, indent="\t") + "\n")

    lock_path = src / "package-lock.json"
    if lock_path.is_file():
        lock = json.loads(lock_path.read_text(encoding="utf-8"))
        lock["version"] = VERSION
        packages = lock.get("packages")
        if isinstance(packages, dict) and isinstance(packages.get(""), dict):
            packages[""]["version"] = VERSION
        lock_path.write_text(json.dumps(lock, indent="\t") + "\n")


def copy_extension(src: Path) -> None:
    dest = src / "extensions" / "copix-agent"
    if dest.exists():
        shutil.rmtree(dest)
    shutil.copytree(
        ROOT / "extensions" / "copix-agent",
        dest,
        ignore=shutil.ignore_patterns("node_modules", "out", "dist", ".vscodeignore"),
    )
    # vsce reads .vscodeignore. Keep it.
    ignore = ROOT / "extensions" / "copix-agent" / ".vscodeignore"
    if ignore.is_file():
        shutil.copyfile(ignore, dest / ".vscodeignore")


def exclude_extensions(src: Path) -> None:
    extra = json.loads((ROOT / "extensions.exclude.json").read_text(encoding="utf-8"))
    path = src / "build" / "lib" / "extensions.ts"
    text = path.read_text(encoding="utf-8")
    anchor = "const excludedExtensions = ["
    require_anchor(text, anchor, path.name)
    insertion = "".join(f"\t'{name}',\n" for name in extra)
    # The array already lists some of these. Duplicates are harmless for indexOf.
    text = text.replace(anchor, anchor + "\n" + insertion, 1)
    path.write_text(text)
    copilot = src / "extensions" / "copilot"
    if copilot.exists():
        shutil.rmtree(copilot)


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text(encoding="utf-8")
    if old in text:
        path.write_text(text.replace(old, new, 1))
        return
    if new in text:
        return
    raise SystemExit(f"{path.name} is missing the expected anchor:\n{old}")


def patch_npm_dirs(src: Path) -> None:
    """postinstall.ts spawns npm in every listed directory. A removed folder makes that spawn fail."""
    path = src / "build" / "npm" / "dirs.ts"
    text = path.read_text()
    marker = "Copix skips extension directories that were removed"
    if marker in text:
        return
    path.write_text(text.rstrip() + """

// Copix skips extension directories that were removed before npm ci.
for (let i = dirs.length - 1; i >= 0; i--) {
	const dir = dirs[i];
	if (dir && !existsSync(`${import.meta.dirname}/../../${dir}`)) {
		dirs.splice(i, 1);
	}
}
""")


def patch_idle_startup(src: Path) -> None:
    """Keep the extension host quiet until the user opens a repo or a TypeScript file."""
    replace_once(
        src / "extensions/git/package.json",
        '    "*",\n    "onEditSession:file",',
        '    "workspaceContains:.git",\n    "onEditSession:file",',
    )
    replace_once(
        src / "extensions/git-base/package.json",
        '  "activationEvents": [\n    "*"\n  ],',
        '  "activationEvents": [\n    "workspaceContains:.git"\n  ],',
    )
    replace_once(
        src / "extensions/merge-conflict/package.json",
        '  "activationEvents": [\n    "onStartupFinished"\n  ],',
        '  "activationEvents": [\n    "workspaceContains:.git"\n  ],',
    )
    replace_once(
        src / "extensions/debug-auto-launch/package.json",
        '  "activationEvents": [\n    "onStartupFinished"\n  ],',
        '  "activationEvents": [\n    "onDebug"\n  ],',
    )
    replace_once(
        src / "extensions/npm/package.json",
        '    "onTaskType:npm",\n    "onLanguage:json",\n    "workspaceContains:package.json"\n',
        '    "onTaskType:npm"\n',
    )
    replace_once(
        src / "extensions/emmet/package.json",
        '    "onCommand:emmet.expandAbbreviation",\n    "onLanguage"\n',
        '    "onCommand:emmet.expandAbbreviation"\n',
    )
    replace_once(
        src / "extensions/typescript-language-features/package.json",
        '    "onLanguage:javascript",\n'
        '    "onLanguage:javascriptreact",\n'
        '    "onLanguage:typescript",\n'
        '    "onLanguage:typescriptreact",\n'
        '    "onLanguage:jsx-tags",\n'
        '    "onCommand:typescript.tsserverRequest",\n'
        '    "onCommand:_typescript.configurePlugin",\n'
        '    "onCommand:_typescript.learnMoreAboutRefactorings",\n'
        '    "onCommand:typescript.fileReferences",\n'
        '    "onTaskType:typescript",\n'
        '    "onLanguage:jsonc",\n'
        '    "onWalkthrough:nodejsWelcome"\n',
        '    "onLanguage:typescript",\n'
        '    "onLanguage:typescriptreact",\n'
        '    "onCommand:typescript.tsserverRequest",\n'
        '    "onCommand:_typescript.configurePlugin",\n'
        '    "onCommand:_typescript.learnMoreAboutRefactorings",\n'
        '    "onCommand:typescript.fileReferences",\n'
        '    "onTaskType:typescript"\n',
    )


def patch_activity_order(src: Path) -> None:
    debug = src / "src/vs/workbench/contrib/debug/browser/debug.contribution.ts"
    debug_text = debug.read_text(encoding="utf-8")
    debug_anchor = "\ticon: icons.runViewIcon,\n\talwaysUseContainerInfo: true,\n\torder: 3,"
    require_anchor(debug_text, debug_anchor, debug.name)
    debug.write_text(debug_text.replace(
        debug_anchor,
        "\ticon: icons.runViewIcon,\n\talwaysUseContainerInfo: true,\n\torder: 10,",
        1,
    ))

    extensions = src / "src/vs/workbench/contrib/extensions/browser/extensions.contribution.ts"
    ext_text = extensions.read_text(encoding="utf-8")
    ext_anchor = "\t\ticon: extensionsViewIcon,\n\t\torder: 4,"
    require_anchor(ext_text, ext_anchor, extensions.name)
    extensions.write_text(ext_text.replace(
        ext_anchor,
        "\t\ticon: extensionsViewIcon,\n\t\torder: 11,",
        1,
    ))


def patch_copilot_shim(src: Path) -> None:
    path = src / "build" / "gulpfile.vscode.ts"
    text = path.read_text(encoding="utf-8")
    anchor = "\t\tconst builtInCopilotExtensionDir = path.join(appBase, 'extensions', 'copilot');\n"
    require_anchor(text, anchor, path.name)
    guard = (
        anchor
        + "\t\tif (!fs.existsSync(builtInCopilotExtensionDir)) {\n"
        + "\t\t\treturn;\n"
        + "\t\t}\n"
    )
    path.write_text(text.replace(anchor, guard, 1))


def patch_missing_chat_agent(src: Path) -> None:
    """Code-OSS 1.141 treats a missing default chat agent as 'no Copilot'.
    A few startup paths still dereference it. Guard those so the shell boots.
    """
    onboarding = src / "src/vs/workbench/contrib/welcomeOnboarding/browser/onboardingVariationA.ts"
    text = onboarding.read_text(encoding="utf-8")
    anchor = "assertDefined(product.defaultChatAgent, 'Onboarding requires a default chat agent product configuration.');\n"
    require_anchor(text, anchor, onboarding.name)
    onboarding.write_text(text.replace(anchor, "", 1))

    accounts = src / "src/vs/workbench/services/accounts/browser/defaultAccount.ts"
    text = accounts.read_text(encoding="utf-8")
    ctor = "\t\tthis.defaultAccountConfig = toDefaultAccountConfig(productService.defaultChatAgent);\n"
    require_anchor(text, ctor, accounts.name)
    empty = (
        "\t\tthis.defaultAccountConfig = productService.defaultChatAgent\n"
        "\t\t\t? toDefaultAccountConfig(productService.defaultChatAgent)\n"
        "\t\t\t: { preferredExtensions: [], authenticationProvider: { default: { id: 'copix', name: 'Copix' }, enterprise: { id: 'copix', name: 'Copix' }, enterpriseProviderConfig: 'copix.unused', scopes: [] }, entitlementUrl: '', tokenEntitlementUrl: '', mcpRegistryDataUrl: '', managedSettingsUrl: '' };\n"
    )
    text = text.replace(ctor, empty, 1)
    contrib = (
        "\t\tconst defaultAccountProvider = this._register(instantiationService.createInstance(DefaultAccountProvider, toDefaultAccountConfig(productService.defaultChatAgent)));\n"
        "\t\tdefaultAccountService.setDefaultAccountProvider(defaultAccountProvider);\n"
    )
    require_anchor(text, contrib, accounts.name)
    text = text.replace(
        contrib,
        "\t\tif (!productService.defaultChatAgent) {\n"
        "\t\t\treturn;\n"
        "\t\t}\n" + contrib,
        1,
    )
    accounts.write_text(text)

    gallery = src / "src/vs/platform/extensionManagement/common/extensionGalleryService.ts"
    text = gallery.read_text(encoding="utf-8")
    mark = "\t\tdeprecated[this.productService.defaultChatAgent.extensionId.toLowerCase()] = {"
    require_anchor(text, mark, gallery.name)
    gallery.write_text(text.replace(
        mark,
        "\t\tif (this.productService.defaultChatAgent) deprecated[this.productService.defaultChatAgent.extensionId.toLowerCase()] = {",
        1,
    ))

    uninstall = src / "src/vs/platform/extensionManagement/common/abstractExtensionManagementService.ts"
    text = uninstall.read_text(encoding="utf-8")
    gate = "\t\tif (areSameExtensions(extension.identifier, { id: this.productService.defaultChatAgent.extensionId })) {"
    require_anchor(text, gate, uninstall.name)
    uninstall.write_text(text.replace(
        gate,
        "\t\tif (this.productService.defaultChatAgent && areSameExtensions(extension.identifier, { id: this.productService.defaultChatAgent.extensionId })) {",
        1,
    ))

    workbench = src / "src/vs/workbench/contrib/extensions/browser/extensionsWorkbenchService.ts"
    text = workbench.read_text(encoding="utf-8")
    gate = "\t\tif (!areSameExtensions(extension.identifier, { id: this.productService.defaultChatAgent.extensionId })) {"
    require_anchor(text, gate, workbench.name)
    workbench.write_text(text.replace(
        gate,
        "\t\tif (!this.productService.defaultChatAgent || !areSameExtensions(extension.identifier, { id: this.productService.defaultChatAgent.extensionId })) {",
        1,
    ))


def patch_exe_metadata(src: Path) -> None:
    path = src / "build" / "gulpfile.vscode.ts"
    text = path.read_text(encoding="utf-8")
    text = text.replace("'CompanyName': 'Microsoft Corporation',", "'CompanyName': 'Copix',")
    text = text.replace(
        "'LegalCopyright': 'Copyright (C) 2026 Microsoft. All rights reserved',",
        "'LegalCopyright': 'Copyright (C) Copix. Portions Copyright (C) Microsoft Corporation.',",
    )
    path.write_text(text)


def install_icons(src: Path) -> None:
    import importlib.util

    script = REPO / "scripts" / "render-desktop-icons.py"
    spec = importlib.util.spec_from_file_location("render_desktop_icons", script)
    if spec is None or spec.loader is None:
        raise SystemExit(f"Cannot load {script}")
    icons = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(icons)
    source = icons.SOURCE
    if not source.is_file():
        raise SystemExit(f"Missing {source}")
    with icons.Image.open(source) as opened:
        tile = opened.convert("RGBA")
    save_png = icons.save_png
    scale = icons.scale
    write_icns = icons.write_icns
    write_ico = icons.write_ico
    resources = src / "resources"
    save_png(scale(tile, 512), resources / "linux" / "code.png")
    save_png(scale(tile, 192), resources / "server" / "code-192.png")
    save_png(scale(tile, 512), resources / "server" / "code-512.png")
    save_png(scale(tile, 150), resources / "win32" / "code_150x150.png")
    save_png(scale(tile, 70), resources / "win32" / "code_70x70.png")
    write_ico(tile, resources / "win32" / "code.ico")
    write_icns(tile, resources / "darwin" / "code.icns")

    mark = (ROOT / "resources" / "code-icon.svg").read_text(encoding="utf-8")
    (src / "src/vs/workbench/browser/media/code-icon.svg").write_text(mark)
    letter = (ROOT / "resources" / "letterpress.svg").read_text(encoding="utf-8")
    media = src / "src/vs/workbench/browser/parts/editor/media"
    for name in ("letterpress-dark.svg", "letterpress-light.svg", "letterpress-hcDark.svg", "letterpress-hcLight.svg"):
        (media / name).write_text(letter)


def append_notices(src: Path) -> None:
    credit = (ROOT / "NOTICE.md").read_text(encoding="utf-8").strip() + "\n"
    notices = src / "ThirdPartyNotices.txt"
    existing = notices.read_text(encoding="utf-8") if notices.is_file() else ""
    if "Codicons" not in existing.split("--- Copix ---")[-1]:
        notices.write_text(existing.rstrip() + "\n\n--- Copix ---\n\n" + credit)
    (src / "NOTICE.txt").write_text(credit)


def rebrand_tree(src: Path) -> None:
    roots = [src / "src", src / "extensions", src / "resources", src / "build"]
    for root in roots:
        if not root.exists():
            continue
        for path in root.rglob("*"):
            if not path.is_file():
                continue
            if path.name in SKIP_FILES or path.suffix.lower() not in TEXT_SUFFIXES:
                continue
            if any(part in SKIP_DIR_NAMES for part in path.parts):
                continue
            if "copix-agent" in path.parts:
                continue
            try:
                text = path.read_text(encoding="utf-8")
            except (UnicodeDecodeError, OSError):
                continue
            updated = []
            changed = False
            for line in text.splitlines(keepends=True):
                if "Copyright" in line and "Microsoft" in line:
                    updated.append(line)
                    continue
                new = line
                for old, repl in REPLACEMENTS:
                    new = new.replace(old, repl)
                if new != line:
                    changed = True
                updated.append(new)
            if changed:
                path.write_text("".join(updated), encoding="utf-8")


def prepare(src: Path) -> None:
    src = src.resolve()
    if not (src / "product.json").is_file():
        raise SystemExit(f"{src} is not a vscode checkout")
    merge_product(src)
    copy_extension(src)
    exclude_extensions(src)
    patch_npm_dirs(src)
    patch_idle_startup(src)
    patch_activity_order(src)
    patch_copilot_shim(src)
    patch_exe_metadata(src)
    patch_missing_chat_agent(src)
    install_icons(src)
    append_notices(src)
    rebrand_tree(src)
    product = json.loads((src / "product.json").read_text(encoding="utf-8"))
    if product.get("nameShort") != "Copix":
        raise SystemExit("product.json was not branded")
    if product.get("extensionsGallery", {}).get("serviceUrl", "").find("open-vsx.org") < 0:
        raise SystemExit("gallery is not Open VSX")
    if "marketplace.visualstudio.com" in json.dumps(product):
        raise SystemExit("product.json still points at the Microsoft marketplace")
    if product.get("builtInExtensions"):
        raise SystemExit("third-party built-in extensions are still listed")
    if not (src / "extensions" / "copix-agent" / "package.json").is_file():
        raise SystemExit("Copix Agent extension was not copied")
    if (src / "extensions" / "copilot").exists():
        raise SystemExit("GitHub Copilot extension is still in the tree")
    print(f"Prepared Copix {VERSION} on {src}")


def main() -> None:
    if len(sys.argv) != 3 or sys.argv[1] != "--src":
        raise SystemExit("usage: python3 code-oss/prepare.py --src <vscode checkout>")
    prepare(Path(sys.argv[2]))


if __name__ == "__main__":
    main()
