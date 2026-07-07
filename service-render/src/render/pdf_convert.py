"""docx → PDF conversion via LibreOffice headless (FR-EXP-01 step 8,
FR-EXP-09). PDF is always derived from the exported docx, never a separate
rendering path, so the two can't diverge.
"""

from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path


class PdfConversionError(RuntimeError):
    pass


def convert_docx_to_pdf(docx_bytes: bytes, soffice_bin: str, timeout_seconds: int) -> bytes:
    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        docx_path = tmp_path / "input.docx"
        docx_path.write_bytes(docx_bytes)

        try:
            subprocess.run(
                [
                    soffice_bin,
                    "--headless",
                    "--convert-to",
                    "pdf",
                    "--outdir",
                    str(tmp_path),
                    str(docx_path),
                ],
                check=True,
                capture_output=True,
                timeout=timeout_seconds,
            )
        except FileNotFoundError as exc:
            raise PdfConversionError(f"LibreOffice binary {soffice_bin!r} not found") from exc
        except subprocess.CalledProcessError as exc:
            raise PdfConversionError(f"LibreOffice conversion failed: {exc.stderr.decode(errors='replace')}") from exc
        except subprocess.TimeoutExpired as exc:
            raise PdfConversionError(f"LibreOffice conversion timed out after {timeout_seconds}s") from exc

        pdf_path = tmp_path / "input.pdf"
        if not pdf_path.exists():
            raise PdfConversionError("LibreOffice did not produce an output PDF")
        return pdf_path.read_bytes()
