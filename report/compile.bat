@echo off
REM Compila el reporte LaTeX (requiere MiKTeX o TeX Live)
REM Ejecutar desde la carpeta report/

pdflatex -interaction=nonstopmode main.tex
pdflatex -interaction=nonstopmode main.tex
echo.
echo === Compilacion completa. Abrir main.pdf ===
