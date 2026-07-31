#!/usr/bin/env python3
import json
import os
import re
import sys

def main():
    build_dir = sys.argv[1]
    with open(f"{build_dir}/../branding.json") as f:
        brand = json.load(f)

    app_name = brand["app_display_name"]
    app_safe = brand["app_name_safe"]
    default_lang = brand.get("default_language", "en")
    company = brand.get("company_name", "Your Company")

    path = f"{build_dir}/apps/server/AliasVault.Client/wwwroot/index.template.html"
    with open(path, "r", encoding="utf-8") as f:
        html = f.read()

    # --- Language ---
    html = html.replace('<html lang="en">', f'<html lang="{default_lang}">')

    # --- GetCurrentLanguage fallback ---
    html = html.replace("localStorage.getItem('AppLanguage') ||\n                   'en'",
                         f"localStorage.getItem('AppLanguage') ||\n                   '{default_lang}'")

    # --- HTML title ---
    html = html.replace("<title>AliasVault</title>", f"<title>{app_name}</title>")

    # --- Meta description ---
    html = html.replace("AliasVault - Privacy-first password manager", f"{app_name} - Self-hosted password manager")

    # --- Loading screen strings ---
    html = html.replace("AliasVault is loading", f"{app_name} se est\u00e1 cargando")
    html = html.replace(
        "Initializing secure environment. AliasVault prioritizes your privacy by running entirely in your browser. The first load might take a short while.",
        "Inicializando el entorno seguro. " + company + " prioriza la privacidad ejecut\u00e1ndose completamente en su navegador."
    )

    # --- WebAssembly error ---
    html = html.replace(
        "AliasVault requires WebAssembly, which this browser does not support. Try using a more modern browser that supports WebAssembly.",
        f"{app_name} requiere WebAssembly. Este navegador no lo soporta. Intente usar un navegador m\u00e1s moderno."
    )

    # --- JS loading config object ---
    html = html.replace("title: 'AliasVault is loading'", f"title: '{app_name} se est\u00e1 cargando'")
    html = html.replace(
        "message: 'Initializing secure environment. AliasVault prioritizes your privacy by running entirely in your browser. The first load might take a short while.'",
        f"message: 'Inicializando el entorno seguro. {company} prioriza la privacidad ejecut\u00e1ndose completamente en su navegador.'"
    )
    html = html.replace(
        "webAssemblyError: 'AliasVault requires WebAssembly, which this browser does not support. Try using a more modern browser that supports WebAssembly.'",
        f"webAssemblyError: '{app_name} requiere WebAssembly. Este navegador no lo soporta. Intente usar un navegador m\u00e1s moderno.'"
    )

    # --- Boot failure key ---
    html = html.replace("'aliasvault_boot_failure_handled'", f"'{app_safe}_boot_failure_handled'")

    # --- Console log prefix ---
    html = html.replace("console.warn('AliasVault:", f"console.warn('{app_name}:")
    html = html.replace("console.info('AliasVault:", f"console.info('{app_name}:")
    html = html.replace("console.error('AliasVault:", f"console.error('{app_name}:")

    # --- CSS class references (cosmetic only, keep consistent) ---
    html = html.replace("index-aliasvault-inline-spinner", f"index-{app_safe}-inline-spinner")
    html = html.replace("AliasVault is loading", f"{app_name} se est\u00e1 cargando")

    with open(path, "w", encoding="utf-8") as f:
        f.write(html)

    print(f"  -> Branded index.template.html with '{app_name}' (lang={default_lang})")

    # --- Brand locale files ---
    locales_dir = f"{build_dir}/apps/server/AliasVault.Client/wwwroot/locales"
    if os.path.isdir(locales_dir):
        for locale_file in os.listdir(locales_dir):
            if locale_file.endswith('.json'):
                lpath = os.path.join(locales_dir, locale_file)
                with open(lpath, 'r', encoding='utf-8') as lf:
                    content = lf.read()
                content = content.replace('AliasVault', app_name)
                with open(lpath, 'w', encoding='utf-8') as lf:
                    lf.write(content)
        print(f"  -> Branded locale files in {locales_dir}")

if __name__ == "__main__":
    main()