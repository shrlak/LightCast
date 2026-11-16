# Builds text.pptx: PowerPoint's dash presets, a text box with inline styles (fonts, sizes, colours, a hyperlink,
# superscript / subscript, character spacing), a table with cell borders, and text warped onto a path.
import sys
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_CONNECTOR, MSO_SHAPE
from lxml import etree
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
prs = Presentation(); prs.slide_width = Inches(10); prs.slide_height = Inches(7.5)
s = prs.slides.add_slide(prs.slide_layouts[6])
DASHES = ['dash', 'sysDash', 'sysDot', 'dot', 'dashDot', 'lgDash', 'lgDashDot', 'lgDashDotDot', 'sysDashDot', 'sysDashDotDot']
for i, d in enumerate(DASHES):
    c = s.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Inches(0.5), Inches(0.3 + i * 0.25), Inches(4), Inches(0.3 + i * 0.25))
    c.name = f'Dash {d}'; c.line.width = Pt(3)
    ln = c.line._get_or_add_ln()
    for old in ln.findall(f'{{{A}}}prstDash'): ln.remove(old)
    pd = etree.SubElement(ln, f'{{{A}}}prstDash'); pd.set('val', d)
    # prstDash must come after the fill
    fill = ln.find(f'{{{A}}}solidFill')
    if fill is not None: fill.addnext(pd)
tb = s.shapes.add_textbox(Inches(0.5), Inches(3.2), Inches(6), Inches(1.5)); tb.name = 'Runs'
p = tb.text_frame.paragraphs[0]
def run(text, size=None, bold=None, color=None, font=None, spc=None, baseline=None, link=None):
    r = p.add_run(); r.text = text
    if size: r.font.size = Pt(size)
    if bold: r.font.bold = True
    if color: r.font.color.rgb = RGBColor.from_string(color)
    if font: r.font.name = font
    rPr = r._r.get_or_add_rPr()
    if spc is not None: rPr.set('spc', str(spc))
    if baseline is not None: rPr.set('baseline', str(baseline))
    if link: r.hyperlink.address = link
    return r
run('Plain ', 18); run('Big red serif ', 28, True, 'CC0000', 'Times New Roman'); run('spaced ', 18, spc=500)
run('x', 18); run('2', 18, baseline=30000); run(' H', 18); run('2', 18, baseline=-25000); run(' ', 18)
run('link', 18, link='https://example.com/')
t = s.shapes.add_table(2, 2, Inches(0.5), Inches(5), Inches(5), Inches(1.2)); t.name = 'Table'
tbl = t.table
for r in range(2):
    for c in range(2):
        cell = tbl.cell(r, c); cell.text = f'{r}{c}'
        tcPr = cell._tc.get_or_add_tcPr()
        for side, color, w, dash in (('lnL', 'FF0000', 28575, 'solid'), ('lnR', '0000FF', 12700, 'dash'), ('lnT', '00AA00', 38100, 'solid'), ('lnB', '000000', 6350, 'solid')):
            ln = etree.SubElement(tcPr, f'{{{A}}}{side}'); ln.set('w', str(w)); ln.set('cap', 'flat'); ln.set('cmpd', 'sng')
            sf = etree.SubElement(ln, f'{{{A}}}solidFill'); etree.SubElement(sf, f'{{{A}}}srgbClr').set('val', color)
            etree.SubElement(ln, f'{{{A}}}prstDash').set('val', dash)
        # borders come before the cell fill in a:tcPr
        fills = [e for e in tcPr if e.tag.endswith('Fill')]
        for f in fills: tcPr.remove(f); tcPr.append(f)
wa = s.shapes.add_textbox(Inches(5.5), Inches(5), Inches(4), Inches(1.5)); wa.name = 'Warp'
wa.text_frame.text = 'Curved text'
bodyPr = wa.text_frame._txBody.find(f'{{{A}}}bodyPr')
etree.SubElement(bodyPr, f'{{{A}}}prstTxWarp').set('prst', 'textArchUp')
prs.save(sys.argv[1])
