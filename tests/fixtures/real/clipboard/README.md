# Clipboard fixtures

Made with python-pptx (`deck20.pptx`: 20 slides, each with a coloured background, a title text box, a rounded
rectangle, a 2x2 table and speaker notes `발표자 노트 N`) and LibreOffice 24.2 `soffice --headless --convert-to`:

- `deck20.ppt`, `deck20.odp`, `deck20.fodp`, `deck20.otp` from `deck20.pptx`
- `deck20.odg`: `deck20.pptx` -> PDF -> `--infilter=draw_pdf_import --convert-to odg` (a real 20-page drawing)
- `libreoffice-rich.fodp`: `../odp/libreoffice-rich.odp` converted to flat XML (pictures as base64)

They are treated as untrusted data by the tests (read-only, never executed).
