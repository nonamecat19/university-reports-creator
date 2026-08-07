"""LaTeX → OMML (Office Math Markup) conversion for formula export (FR-EDT-06).

The editor stores the LaTeX source of a formula and renders it with KaTeX; at
export the same source has to become a *native* Word equation, otherwise the
formula is a picture in an otherwise editable document.

There is no maintained pure-Python LaTeX→OMML converter, and the usual trick —
LaTeX→MathML→OMML through Microsoft's `MML2OMML.XSL` — needs a stylesheet that
ships with Office and cannot be redistributed. So this module converts the
subset of LaTeX the editor's formula palette can produce, directly to OMML, and
raises `UnsupportedLatex` for anything outside it. Callers fall back to a
literal-source run plus an export warning (see `docx_export._translate_formula`).

Supported: symbols/Greek, sub/superscripts, fractions, roots, n-ary operators
(sum/prod/int/lim) with limits, `\\left…\\right` delimiters, upright text
(`\\text`/`\\mathrm`/`\\mathbf`), function names, spacing commands, escapes.
Not supported (→ fallback): matrices/arrays/environments, `\\over`, alignment
(`&`, `\\\\`), and any unknown command.
"""

from __future__ import annotations

import re
from typing import Any

from docx.oxml import OxmlElement
from docx.oxml.ns import qn


class UnsupportedLatex(Exception):
    """Raised when the source uses a construct outside the supported subset."""


# --- symbol tables ---------------------------------------------------------

_GREEK = {
    "alpha": "α", "beta": "β", "gamma": "γ", "delta": "δ", "epsilon": "ϵ",
    "varepsilon": "ε", "zeta": "ζ", "eta": "η", "theta": "θ", "vartheta": "ϑ",
    "iota": "ι", "kappa": "κ", "lambda": "λ", "mu": "μ", "nu": "ν", "xi": "ξ",
    "pi": "π", "varpi": "ϖ", "rho": "ρ", "varrho": "ϱ", "sigma": "σ",
    "varsigma": "ς", "tau": "τ", "upsilon": "υ", "phi": "ϕ", "varphi": "φ",
    "chi": "χ", "psi": "ψ", "omega": "ω",
    "Gamma": "Γ", "Delta": "Δ", "Theta": "Θ", "Lambda": "Λ", "Xi": "Ξ",
    "Pi": "Π", "Sigma": "Σ", "Upsilon": "Υ", "Phi": "Φ", "Psi": "Ψ",
    "Omega": "Ω",
}

_SYMBOLS = {
    **_GREEK,
    "times": "×", "div": "÷", "cdot": "·", "pm": "±", "mp": "∓",
    "leq": "≤", "le": "≤", "geq": "≥", "ge": "≥", "neq": "≠", "ne": "≠",
    "approx": "≈", "equiv": "≡", "sim": "∼", "propto": "∝",
    "ll": "≪", "gg": "≫",
    "infty": "∞", "partial": "∂", "nabla": "∇", "forall": "∀", "exists": "∃",
    "in": "∈", "notin": "∉", "subset": "⊂", "subseteq": "⊆", "supset": "⊃",
    "supseteq": "⊇", "cup": "∪", "cap": "∩", "emptyset": "∅",
    "to": "→", "rightarrow": "→", "leftarrow": "←", "leftrightarrow": "↔",
    "Rightarrow": "⇒", "Leftarrow": "⇐", "Leftrightarrow": "⇔",
    "mapsto": "↦", "ldots": "…", "dots": "…", "cdots": "⋯", "vdots": "⋮",
    "angle": "∠", "perp": "⊥", "parallel": "∥", "degree": "°",
    "prime": "′", "star": "⋆", "circ": "∘", "bullet": "∙",
    "land": "∧", "lor": "∨", "neg": "¬", "oplus": "⊕", "otimes": "⊗",
}

# `\%`, `\{`, … produce the literal character.
_ESCAPES = {"%", "&", "$", "#", "_", "{", "}", " "}

# Spacing commands → the corresponding Unicode space (`\!` has no equivalent).
_SPACES = {",": " ", ":": " ", ";": " ", "!": "", "quad": " ", "qquad": "  "}

# Rendered upright, the way Word renders known function names.
_FUNCTIONS = {
    "sin", "cos", "tan", "cot", "sec", "csc", "arcsin", "arccos", "arctan",
    "sinh", "cosh", "tanh", "ln", "log", "lg", "exp", "det", "dim", "gcd",
    "deg", "mod", "max", "min", "sup", "inf", "arg",
}

_UPRIGHT_TEXT = {"text", "mathrm", "mathbf", "mathsf", "mathtt", "operatorname", "mbox"}

# n-ary operators: command → (glyph, limit location). `lim` is not an n-ary
# glyph in OMML and is built as a function with a lower limit instead.
_NARY = {
    "sum": ("∑", "undOvr"),
    "prod": ("∏", "undOvr"),
    "coprod": ("∐", "undOvr"),
    "bigcup": ("⋃", "undOvr"),
    "bigcap": ("⋂", "undOvr"),
    "int": ("∫", "subSup"),
    "iint": ("∬", "subSup"),
    "iiint": ("∭", "subSup"),
    "oint": ("∮", "subSup"),
    "lim": ("", "undOvr"),
}

_DELIMITERS = {
    "(": "(", ")": ")", "[": "[", "]": "]", "|": "|", "/": "/",
    "\\{": "{", "\\}": "}", "\\|": "‖",
    "\\langle": "⟨", "\\rangle": "⟩",
    "\\lfloor": "⌊", "\\rfloor": "⌋", "\\lceil": "⌈", "\\rceil": "⌉",
    ".": "",  # `\left.` / `\right.` — invisible fence
}

_TOKEN_RE = re.compile(r"\\[A-Za-z]+|\\.|\s+|.", re.DOTALL)


def _tokenize(latex: str) -> list[str]:
    """LaTeX whitespace is layout, not content, so it is dropped here."""
    return [t for t in (m.group(0) for m in _TOKEN_RE.finditer(latex)) if not t.isspace()]


# --- OMML element helpers --------------------------------------------------


def _prop(tag: str, value: str) -> Any:
    element = OxmlElement(tag)
    element.set(qn("m:val"), value)
    return element


def _wrap(tag: str, children: list[Any]) -> Any:
    element = OxmlElement(tag)
    for child in children:
        element.append(child)
    return element


def _text_run(text: str, upright: bool = False) -> Any:
    run = OxmlElement("m:r")
    if upright:
        run_props = OxmlElement("m:rPr")
        run_props.append(OxmlElement("m:nor"))
        run.append(run_props)
    t = OxmlElement("m:t")
    t.set(qn("xml:space"), "preserve")
    t.text = text
    run.append(t)
    return run


def _local_name(element: Any) -> str:
    return str(element.tag).split("}")[-1]


# --- parser ----------------------------------------------------------------


class _Parser:
    """Recursive-descent parser over the token stream, emitting OMML directly.

    `_parse_sequence` reads until the end of the current group; group
    terminators (`}`, `\\right`) are left in place for the caller to validate,
    so every construct checks its own balance.
    """

    def __init__(self, tokens: list[str]) -> None:
        self.tokens = tokens
        self.pos = 0

    def _peek(self) -> str | None:
        return self.tokens[self.pos] if self.pos < len(self.tokens) else None

    def _next(self) -> str:
        token = self._peek()
        if token is None:
            raise UnsupportedLatex("unexpected end of formula")
        self.pos += 1
        return token

    def parse(self) -> list[Any]:
        elements = self._parse_sequence()
        leftover = self._peek()
        if leftover is not None:
            raise UnsupportedLatex(f"unbalanced formula near {leftover!r}")
        return elements

    def _parse_sequence(self) -> list[Any]:
        elements: list[Any] = []
        while True:
            token = self._peek()
            if token is None or token == "}" or token == "\\right":
                break

            if token in ("&", "\\\\"):
                raise UnsupportedLatex("alignment / line breaks are not supported")

            if token in ("^", "_"):
                self.pos += 1
                self._apply_script(elements, token)
                continue

            command = token[1:] if token.startswith("\\") and len(token) > 1 else None
            if command in _NARY:
                self.pos += 1
                elements.append(self._parse_nary(command))
                break  # the n-ary operator takes the rest of this group as its operand

            elements.extend(self._parse_atom())
        return elements

    def _apply_script(self, elements: list[Any], kind: str) -> None:
        """Attaches a `^`/`_` script to the element it follows, merging with a
        script already on that base into a single sSubSup."""
        if not elements:
            raise UnsupportedLatex(f"'{kind}' without a base")
        base = elements.pop()
        script = self._parse_atom()
        base_kind = _local_name(base)

        if kind == "^" and base_kind == "sSub":
            e, sub = list(base)
            elements.append(_wrap("m:sSubSup", [e, sub, _wrap("m:sup", script)]))
            return
        if kind == "_" and base_kind == "sSup":
            e, sup = list(base)
            elements.append(_wrap("m:sSubSup", [e, _wrap("m:sub", script), sup]))
            return

        tag, script_tag = ("m:sSup", "m:sup") if kind == "^" else ("m:sSub", "m:sub")
        elements.append(_wrap(tag, [_wrap("m:e", [base]), _wrap(script_tag, script)]))

    def _parse_atom(self) -> list[Any]:
        """Parses the smallest complete unit: a braced group, a command, or a
        single character. Returns a list because a group holds several nodes."""
        token = self._next()

        if token == "{":
            elements = self._parse_sequence()
            if self._peek() != "}":
                raise UnsupportedLatex("unbalanced '{'")
            self.pos += 1
            return elements

        if token in ("}", "^", "_"):
            raise UnsupportedLatex(f"unexpected {token!r}")

        if token.startswith("\\") and len(token) > 1:
            return self._parse_command(token[1:])

        if token == "'":
            return [_text_run("′")]

        return [_text_run(token)]

    def _parse_command(self, command: str) -> list[Any]:
        if command in _ESCAPES:
            return [_text_run(command)]
        if command in _SPACES:
            spacing = _SPACES[command]
            return [_text_run(spacing)] if spacing else []
        if command in _SYMBOLS:
            return [_text_run(_SYMBOLS[command])]
        if command in _FUNCTIONS:
            return [_text_run(command, upright=True)]
        if command in _UPRIGHT_TEXT:
            return [_text_run(self._read_raw_group(), upright=True)]
        if command in ("frac", "dfrac", "tfrac"):
            return [self._parse_frac()]
        if command == "sqrt":
            return [self._parse_sqrt()]
        if command == "left":
            return [self._parse_delimited()]
        if command == "right":
            raise UnsupportedLatex("\\right without \\left")
        raise UnsupportedLatex(f"unsupported command \\{command}")

    def _read_raw_group(self) -> str:
        """Reads `{...}` as literal text — the \\text family holds prose, not
        math, so its contents must not go through the math parser."""
        if self._next() != "{":
            raise UnsupportedLatex("expected '{' after a text command")
        pieces: list[str] = []
        depth = 1
        while True:
            token = self._next()
            if token == "{":
                depth += 1
            elif token == "}":
                depth -= 1
                if depth == 0:
                    break
            # `\ ` (escaped space) inside \text is a real space.
            pieces.append(token[1:] if token.startswith("\\") and len(token) == 2 else token)
        return "".join(pieces)

    def _parse_frac(self) -> Any:
        numerator = self._parse_atom()
        denominator = self._parse_atom()
        return _wrap(
            "m:f",
            [
                _wrap("m:fPr", [_prop("m:type", "bar")]),
                _wrap("m:num", numerator),
                _wrap("m:den", denominator),
            ],
        )

    def _parse_sqrt(self) -> Any:
        degree: list[Any] = []
        if self._peek() == "[":
            self.pos += 1
            while self._peek() not in (None, "]"):
                degree.extend(self._parse_atom())
            if self._peek() != "]":
                raise UnsupportedLatex("unbalanced '[' in \\sqrt")
            self.pos += 1

        return _wrap(
            "m:rad",
            [
                _wrap("m:radPr", [_prop("m:degHide", "0" if degree else "1")]),
                _wrap("m:deg", degree),
                _wrap("m:e", self._parse_atom()),
            ],
        )

    def _parse_delimited(self) -> Any:
        begin = self._delimiter_char()
        body = self._parse_sequence()
        if self._peek() != "\\right":
            raise UnsupportedLatex("\\left without a matching \\right")
        self.pos += 1
        end = self._delimiter_char()

        return _wrap(
            "m:d",
            [
                _wrap("m:dPr", [_prop("m:begChr", begin), _prop("m:endChr", end)]),
                _wrap("m:e", body),
            ],
        )

    def _delimiter_char(self) -> str:
        token = self._next()
        if token not in _DELIMITERS:
            raise UnsupportedLatex(f"unsupported delimiter {token!r}")
        return _DELIMITERS[token]

    def _parse_nary(self, command: str) -> Any:
        glyph, limit_location = _NARY[command]

        sub: list[Any] = []
        sup: list[Any] = []
        while self._peek() in ("_", "^"):
            if self._next() == "_":
                sub = self._parse_atom()
            else:
                sup = self._parse_atom()

        # Everything left in the current group is the operand — the same reading
        # Word applies to `\sum_{i=1}^{n} a_i + b`.
        body = self._parse_sequence()

        if command == "lim":
            lim_low = _wrap("m:limLow", [_wrap("m:e", [_text_run("lim", upright=True)]), _wrap("m:lim", sub)])
            return _wrap("m:func", [_wrap("m:fName", [lim_low]), _wrap("m:e", body)])

        return _wrap(
            "m:nary",
            [
                _wrap(
                    "m:naryPr",
                    [
                        _prop("m:chr", glyph),
                        _prop("m:limLoc", limit_location),
                        _prop("m:subHide", "0" if sub else "1"),
                        _prop("m:supHide", "0" if sup else "1"),
                    ],
                ),
                _wrap("m:sub", sub),
                _wrap("m:sup", sup),
                _wrap("m:e", body),
            ],
        )


# --- public API ------------------------------------------------------------


def latex_to_omml(latex: str) -> Any:
    """Converts LaTeX source to an `m:oMath` element.

    Raises `UnsupportedLatex` when the source is empty or uses a construct
    outside the supported subset; callers fall back to literal text.
    """
    source = (latex or "").strip()
    if not source:
        raise UnsupportedLatex("empty formula")
    if "\\begin" in source or "\\end" in source:
        raise UnsupportedLatex("LaTeX environments are not supported")
    if re.search(r"\\over(?![a-zA-Z])", source):
        raise UnsupportedLatex("\\over is not supported; use \\frac")

    elements = _Parser(_tokenize(source)).parse()
    if not elements:
        raise UnsupportedLatex("formula produced no content")
    return _wrap("m:oMath", elements)
