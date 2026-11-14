import sys
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE, MSO_CONNECTOR
from pptx.enum.text import PP_ALIGN
from pptx.oxml.ns import qn
from lxml import etree
from PIL import Image
out, picpath = sys.argv[1], sys.argv[2]
prs = Presentation(); prs.slide_width = Inches(10); prs.slide_height = Inches(7.5)
blank = prs.slide_layouts[6]
P = 'http://schemas.openxmlformats.org/presentationml/2006/main'

def grad(shape, stops, ang, path=None, alphas=None):
    spPr = shape._element.spPr
    for t in ('a:solidFill', 'a:gradFill', 'a:noFill'):
        for e in spPr.findall(qn(t)): spPr.remove(e)
    g = etree.Element(qn('a:gradFill')); g.set('rotWithShape', '1')
    gl = etree.SubElement(g, qn('a:gsLst'))
    for i, (pos, c) in enumerate(stops):
        gs = etree.SubElement(gl, qn('a:gs')); gs.set('pos', str(pos * 1000))
        cc = etree.SubElement(gs, qn('a:srgbClr')); cc.set('val', c)
        if alphas: etree.SubElement(cc, qn('a:alpha')).set('val', str(alphas[i] * 1000))
    if path:
        p = etree.SubElement(g, qn('a:path')); p.set('path', path)
        f = etree.SubElement(p, qn('a:fillToRect'))
        for k in 'ltrb': f.set(k, '50000')
    else:
        l = etree.SubElement(g, qn('a:lin')); l.set('ang', str(ang * 60000)); l.set('scaled', '0')
    spPr.find(qn('a:prstGeom')).addnext(g)

def trans(slide, xml):
    sld = slide._element
    el = etree.fromstring(xml)
    anchor = sld.find(qn('p:clrMapOvr'))
    if anchor is None: anchor = sld.find(qn('p:cSld'))
    anchor.addnext(el)

# slide 1
s = prs.slides.add_slide(blank)
tb = s.shapes.add_textbox(Inches(1), Inches(0.5), Inches(8), Inches(1.2)); tf = tb.text_frame
tf.text = 'Title Bold Red'; r = tf.paragraphs[0].runs[0]; r.font.bold = True; r.font.size = Pt(36); r.font.color.rgb = RGBColor(255, 0, 0); r.font.name = 'Arial'
p = tf.add_paragraph(); p.alignment = PP_ALIGN.CENTER
r = p.add_run(); r.text = 'italic '; r.font.italic = True; r.font.size = Pt(20)
r = p.add_run(); r.text = 'underline'; r.font.underline = True; r.font.size = Pt(20); r.font.color.rgb = RGBColor(0, 0, 255)
rect = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(1), Inches(2.5), Inches(3), Inches(1.5)); rect.rotation = 30
rect.fill.solid(); rect.fill.fore_color.rgb = RGBColor(0, 128, 0); rect.line.color.rgb = RGBColor(0, 0, 0); rect.line.width = Pt(3)
rect.text_frame.text = 'rot30'
el = s.shapes.add_shape(MSO_SHAPE.OVAL, Inches(5), Inches(2.5), Inches(3), Inches(2)); el.rotation = 300
el.fill.solid(); el.fill.fore_color.rgb = RGBColor(255, 165, 0)
tri = s.shapes.add_shape(MSO_SHAPE.ISOSCELES_TRIANGLE, Inches(1), Inches(5), Inches(2), Inches(2)); tri.rotation = 90
tri.fill.solid(); tri.fill.fore_color.rgb = RGBColor(128, 0, 128)
rr = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(4), Inches(5), Inches(2), Inches(1.5)); rr.fill.solid(); rr.fill.fore_color.rgb = RGBColor(0, 200, 200)
s.notes_slide.notes_text_frame.text = 'Speaker notes line1\nline2'

# slide 2 gradients
s = prs.slides.add_slide(blank)
def gs(x, y, stops, ang, path=None, alphas=None):
    sh = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(x), Inches(y), Inches(2.5), Inches(1.5)); grad(sh, stops, ang, path, alphas); return sh
gs(0.5, 0.5, [(0, 'FF0000'), (100, '0000FF')], 0)
gs(3.5, 0.5, [(0, 'FF0000'), (100, '0000FF')], 90)
gs(6.5, 0.5, [(0, 'FF0000'), (50, '00FF00'), (100, '0000FF')], 0)
gs(0.5, 2.5, [(0, 'FF0000'), (30, '00FF00'), (70, 'FFFF00'), (100, '0000FF')], 45)
gs(3.5, 2.5, [(0, 'FFFFFF'), (100, '000000')], 0, 'circle')
gs(6.5, 2.5, [(0, 'FFFFFF'), (40, 'FF00FF'), (100, '000000')], 0, 'circle')
gs(0.5, 4.5, [(0, 'FF0000'), (100, '0000FF')], 135)
gs(3.5, 4.5, [(0, 'FF0000'), (100, '0000FF')], 270)
gs(6.5, 4.5, [(0, 'FF0000'), (100, '0000FF')], 0, None, [100, 20])
bg = s.background.fill; bg.gradient(); bg.gradient_angle = 90
bg.gradient_stops[0].color.rgb = RGBColor(255, 255, 200); bg.gradient_stops[1].color.rgb = RGBColor(200, 200, 255)

# slide 3
s = prs.slides.add_slide(blank)
grp = s.shapes.add_group_shape()
a = grp.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.5), Inches(0.5), Inches(2), Inches(1)); a.fill.solid(); a.fill.fore_color.rgb = RGBColor(255, 0, 0)
b = grp.shapes.add_shape(MSO_SHAPE.OVAL, Inches(1.5), Inches(1), Inches(2), Inches(1)); b.fill.solid(); b.fill.fore_color.rgb = RGBColor(0, 0, 255)
grp.rotation = 20
gt = s.shapes.add_table(3, 3, Inches(4), Inches(0.5), Inches(5), Inches(2)); t = gt.table
for r_ in range(3):
    for c_ in range(3): t.cell(r_, c_).text = f'r{r_}c{c_}'
t.cell(0, 0).fill.solid(); t.cell(0, 0).fill.fore_color.rgb = RGBColor(255, 200, 0)
t.cell(1, 1).merge(t.cell(2, 2))
gt2 = s.shapes.add_table(2, 2, Inches(1), Inches(4.5), Inches(3), Inches(1.2))
for r_ in range(2):
    for c_ in range(2): gt2.table.cell(r_, c_).text = f'R{r_}{c_}'
gt2._element.xfrm.set('rot', str(15 * 60000))
im = Image.new('RGB', (40, 30), (10, 200, 50))
for x in range(20):
    for y in range(30): im.putpixel((x, y), (200, 20, 20))
im.save(picpath)
pic = s.shapes.add_picture(picpath, Inches(5), Inches(4), Inches(2), Inches(1.5)); pic.rotation = 10
cn = s.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Inches(1), Inches(7), Inches(4), Inches(6.2)); cn.line.width = Pt(2); cn.line.color.rgb = RGBColor(0, 0, 0)
ln = cn.line._get_or_add_ln(); etree.SubElement(ln, qn('a:tailEnd')).set('type', 'triangle')
sd = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(7.5), Inches(6), Inches(1.5), Inches(1)); sd.fill.solid(); sd.fill.fore_color.rgb = RGBColor(200, 200, 200)
ef = etree.SubElement(sd._element.spPr, qn('a:effectLst')); sh = etree.SubElement(ef, qn('a:outerShdw'))
for k, v in dict(blurRad='50800', dist='38100', dir='2700000', algn='tl', rotWithShape='0').items(): sh.set(k, v)
c = etree.SubElement(sh, qn('a:srgbClr')); c.set('val', '000000'); etree.SubElement(c, qn('a:alpha')).set('val', '40000')

# slide 4
s = prs.slides.add_slide(blank)
s.background.fill.solid(); s.background.fill.fore_color.rgb = RGBColor(240, 230, 200)
tb = s.shapes.add_textbox(Inches(1), Inches(1), Inches(6), Inches(3)); tf = tb.text_frame; tf.word_wrap = True
tf.text = 'Bullet one'
for t_ in ['Bullet two', 'Bullet three']: tf.add_paragraph().text = t_
for p in tf.paragraphs:
    pPr = p._p.get_or_add_pPr(); pPr.set('marL', '342900'); pPr.set('indent', '-342900'); etree.SubElement(pPr, qn('a:buChar')).set('char', '•')
bp = tf._txBody.find(qn('a:bodyPr')); etree.SubElement(bp, qn('a:normAutofit'))
tb2 = s.shapes.add_textbox(Inches(1), Inches(4.5), Inches(6), Inches(1.5)); tf = tb2.text_frame; tf.text = 'First'; tf.add_paragraph().text = 'Second'
for p in tf.paragraphs:
    pPr = p._p.get_or_add_pPr(); pPr.set('marL', '342900'); pPr.set('indent', '-342900'); etree.SubElement(pPr, qn('a:buAutoNum')).set('type', 'arabicPeriod')
for i, (dash, w) in enumerate([('dash', 2), ('sysDot', 4)]):
    c2 = s.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Inches(1), Inches(6.3 + i * 0.4), Inches(6), Inches(6.3 + i * 0.4)); c2.line.width = Pt(w); c2.line.color.rgb = RGBColor(255, 0, 0)
    ln = c2.line._get_or_add_ln(); etree.SubElement(ln, qn('a:prstDash')).set('val', dash); etree.SubElement(ln, qn('a:headEnd')).set('type', 'oval'); etree.SubElement(ln, qn('a:tailEnd')).set('type', 'arrow')
trans(s, f'<p:transition xmlns:p="{P}" spd="slow" advClick="0" advTm="4000"><p:fade/></p:transition>')
s5 = prs.slides.add_slide(blank); s5.shapes.add_textbox(Inches(1), Inches(1), Inches(5), Inches(1)).text_frame.text = 'hidden slide'
s5._element.set('show', '0')
trans(s5, f'<p:transition xmlns:p="{P}" spd="med"><p:push dir="u"/></p:transition>')
m = prs.slide_master
A_='http://schemas.openxmlformats.org/drawingml/2006/main'
xml=f'<p:sp xmlns:p="{P}" xmlns:a="{A_}"><p:nvSpPr><p:cNvPr id="99" name="MasterBar"/><p:cNvSpPr/><p:nvPr userDrawn="1"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="6583680"/><a:ext cx="9144000" cy="274320"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="1E1E78"/></a:solidFill></p:spPr></p:sp>'
m.shapes._spTree.append(etree.fromstring(xml))
prs.save(out)
