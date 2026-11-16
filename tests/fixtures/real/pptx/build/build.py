import copy, io, sys, zipfile
from lxml import etree
from PIL import Image, ImageDraw
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE, MSO_CONNECTOR
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.chart.data import CategoryChartData, XyChartData, BubbleChartData
from pptx.enum.chart import XL_CHART_TYPE, XL_LEGEND_POSITION
from pptx.oxml.ns import qn

OUT = sys.argv[1]
A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
def X(s):
    return etree.fromstring(s)

def png(path, w=240, h=160, c1=(220, 60, 60), c2=(60, 80, 200)):
    im = Image.new('RGB', (w, h), c1)
    d = ImageDraw.Draw(im)
    for i in range(0, w, 20):
        d.rectangle([i, 0, i + 9, h], fill=c2)
    d.ellipse([w // 4, h // 4, 3 * w // 4, 3 * h // 4], outline=(255, 255, 255), width=6)
    im.save(path)
png(OUT + '/a.png')
png(OUT + '/b.png', 300, 300, (30, 160, 90), (250, 220, 40))

def new(wide=False):
    p = Presentation()
    if wide:
        p.slide_width = Inches(13.333); p.slide_height = Inches(7.5)
    return p

def blank(p, layout=6):
    return p.slides.add_slide(p.slide_layouts[layout])

def tb(s, x, y, w, h, text='', size=18, **kw):
    t = s.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = t.text_frame
    tf.word_wrap = True
    tf.text = text
    for r in tf.paragraphs[0].runs:
        r.font.size = Pt(size)
    return t

# ───────── 1 text (4:3) ─────────
p = new()
s = blank(p)
t = tb(s, 0.5, 0.3, 9, 1, 'Run properties: ', 20)
para = t.text_frame.paragraphs[0]
def run(para, text, **f):
    r = para.add_run(); r.text = text
    r.font.size = Pt(f.get('size', 20))
    if f.get('b'): r.font.bold = True
    if f.get('i'): r.font.italic = True
    if f.get('u'): r.font.underline = True
    if f.get('color'): r.font.color.rgb = RGBColor.from_string(f['color'])
    if f.get('name'): r.font.name = f['name']
    rPr = r._r.get_or_add_rPr()
    if f.get('strike'): rPr.set('strike', 'sngStrike')
    if f.get('base'): rPr.set('baseline', str(f['base']))
    if f.get('spc'): rPr.set('spc', str(f['spc']))
    if f.get('hl'):
        rPr.append(X('<a:highlight xmlns:a="%s"><a:srgbClr val="%s"/></a:highlight>' % (A, f['hl'])))
    if f.get('link'):
        r.hyperlink.address = f['link']
    return r
run(para, 'bold ', b=1); run(para, 'italic ', i=1); run(para, 'under ', u=1); run(para, 'strike ', strike=1)
run(para, 'red ', color='CC0000'); run(para, 'Georgia ', name='Georgia'); run(para, 'x', base=30000); run(para, '2', base=-25000)
run(para, ' spaced ', spc=300); run(para, 'highlight', hl='FFFF00'); run(para, ' link', link='https://example.com', color='0563C1', u=1)
run(para, ' 한글 글꼴 맑은 고딕', name='맑은 고딕')
# bullets & numbering
t = tb(s, 0.5, 1.6, 4.4, 3, '', 16)
tf = t.text_frame
lines = [('Level 0 bullet', 0, 'bu'), ('Level 1 bullet', 1, 'bu'), ('Level 2 bullet', 2, 'bu'), ('Number one', 0, 'num'), ('Number two', 0, 'num'), ('Sub alpha', 1, 'alpha')]
for i, (txt, lvl, kind) in enumerate(lines):
    pa = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
    pa.text = txt; pa.level = lvl
    for r in pa.runs: r.font.size = Pt(16)
    pPr = pa._p.get_or_add_pPr()
    pPr.set('marL', str(342900 * (lvl + 1))); pPr.set('indent', '-285750')
    if kind == 'bu': pPr.append(X('<a:buChar xmlns:a="%s" char="•"/>' % A))
    elif kind == 'num': pPr.append(X('<a:buAutoNum xmlns:a="%s" type="arabicPeriod"/>' % A))
    else: pPr.append(X('<a:buAutoNum xmlns:a="%s" type="alphaLcParenR"/>' % A))
# spacing, indents, tabs, alignment
t = tb(s, 5.2, 1.6, 4.3, 3, '', 14)
tf = t.text_frame
for i, (txt, al) in enumerate([('Left aligned with line spacing 150%', PP_ALIGN.LEFT), ('Centered paragraph with space before 12 pt', PP_ALIGN.CENTER), ('Right aligned paragraph, exactly 30pt line', PP_ALIGN.RIGHT), ('Justified paragraph that is long enough to wrap onto several lines for justification to be visible here.', PP_ALIGN.JUSTIFY)]):
    pa = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
    pa.text = txt; pa.alignment = al
    for r in pa.runs: r.font.size = Pt(14)
    if i == 0: pa.line_spacing = 1.5
    if i == 1: pa.space_before = Pt(12)
    if i == 2: pa.line_spacing = Pt(30)
    if i == 3: pa.space_after = Pt(6)
# autofit / anchor / rotation / columns / vertical
t = tb(s, 0.5, 4.9, 2.2, 1.0, 'Anchor bottom, wrap on, fill', 14)
t.text_frame.vertical_anchor = MSO_ANCHOR.BOTTOM
t.fill.solid(); t.fill.fore_color.rgb = RGBColor(0xDD, 0xEE, 0xFF)
t.line.color.rgb = RGBColor(0, 0, 0)
t = tb(s, 2.9, 4.9, 2.2, 1.0, 'Rotated 15 degrees', 14); t.rotation = 15
t = tb(s, 5.3, 4.9, 2.2, 1.4, 'Two columns of text that flows from the first column to the second one when long.', 12)
t.text_frame._txBody.bodyPr.set('numCol', '2')
t = tb(s, 7.8, 4.9, 1.2, 2.0, 'Vertical 세로', 16)
t.text_frame._txBody.bodyPr.set('vert', 'eaVert')
t = tb(s, 0.5, 6.4, 6, 0.8, 'No wrap, shrink on overflow: a very long line of text that does not fit in the box', 20)
t.text_frame._txBody.bodyPr.append(X('<a:normAutofit xmlns:a="%s" fontScale="70000"/>' % A))
# title slide with placeholders
s2 = p.slides.add_slide(p.slide_layouts[0])
s2.shapes.title.text = 'Title placeholder (inherits)'
s2.placeholders[1].text = 'Subtitle placeholder inherits position and size'
s3 = p.slides.add_slide(p.slide_layouts[1])
s3.shapes.title.text = 'Title and content'
tf = s3.placeholders[1].text_frame
tf.text = 'First bullet level 0'
for txt, lv in [('Second bullet level 1', 1), ('Third level 2', 2), ('Back to 0', 0)]:
    pa = tf.add_paragraph(); pa.text = txt; pa.level = lv
p.save(OUT + '/text43.pptx')

# ───────── 2 shapes (16:9) ─────────
p = new(True)
s = blank(p)
presets = [MSO_SHAPE.ROUNDED_RECTANGLE, MSO_SHAPE.OVAL, MSO_SHAPE.ISOSCELES_TRIANGLE, MSO_SHAPE.RIGHT_ARROW, MSO_SHAPE.STAR_5_POINT, MSO_SHAPE.HEART, MSO_SHAPE.CLOUD, MSO_SHAPE.CHEVRON, MSO_SHAPE.DONUT, MSO_SHAPE.BLOCK_ARC, MSO_SHAPE.RIGHT_BRACE, MSO_SHAPE.FLOWCHART_DECISION, MSO_SHAPE.WAVE, MSO_SHAPE.LIGHTNING_BOLT, MSO_SHAPE.MOON, MSO_SHAPE.RECTANGULAR_CALLOUT]
for i, pr in enumerate(presets):
    x = 0.4 + (i % 8) * 1.55; y = 0.4 + (i // 8) * 1.5
    sh = s.shapes.add_shape(pr, Inches(x), Inches(y), Inches(1.3), Inches(1.2))
    sh.fill.solid(); sh.fill.fore_color.rgb = RGBColor((i * 40) % 256, 120, 220 - (i * 10) % 200)
    sh.line.color.rgb = RGBColor(40, 40, 40); sh.line.width = Pt(2)
    if i == 0: sh.adjustments[0] = 0.5
    if i == 3: sh.adjustments[0] = 0.3; sh.adjustments[1] = 0.8
    if i == 4: sh.text_frame.text = 'Star'
# fills row
def fillshape(x, y, fx, text=''):
    sh = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(x), Inches(y), Inches(1.9), Inches(1.2))
    spPr = sh._element.spPr
    for tag in ('solidFill', 'noFill', 'gradFill', 'pattFill', 'blipFill'):
        for e in spPr.findall(qn('a:' + tag)): spPr.remove(e)
    geom = spPr.find(qn('a:prstGeom'))
    geom.addnext(fx)
    sh.line.color.rgb = RGBColor(0, 0, 0)
    if text: sh.text_frame.text = text
    return sh
fillshape(0.4, 3.6, X('<a:gradFill xmlns:a="%s" rotWithShape="1"><a:gsLst><a:gs pos="0"><a:srgbClr val="FF0000"/></a:gs><a:gs pos="50000"><a:srgbClr val="FFFF00"/></a:gs><a:gs pos="100000"><a:srgbClr val="0000FF"/></a:gs></a:gsLst><a:lin ang="2700000" scaled="0"/></a:gradFill>' % A), 'grad 3-stop')
fillshape(2.5, 3.6, X('<a:gradFill xmlns:a="%s"><a:gsLst><a:gs pos="0"><a:srgbClr val="FFFFFF"/></a:gs><a:gs pos="100000"><a:srgbClr val="006600"/></a:gs></a:gsLst><a:path path="circle"><a:fillToRect l="50000" t="50000" r="50000" b="50000"/></a:path></a:gradFill>' % A), 'radial')
fillshape(4.6, 3.6, X('<a:pattFill xmlns:a="%s" prst="dkUpDiag"><a:fgClr><a:srgbClr val="0000AA"/></a:fgClr><a:bgClr><a:srgbClr val="FFFFFF"/></a:bgClr></a:pattFill>' % A), 'pattern')
sh = fillshape(6.7, 3.6, X('<a:solidFill xmlns:a="%s"><a:srgbClr val="2E75B6"><a:alpha val="40000"/></a:srgbClr></a:solidFill>' % A), 'alpha 40%')
# effects
sh = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(9.0), Inches(3.6), Inches(1.6), Inches(1.2))
sh.fill.solid(); sh.fill.fore_color.rgb = RGBColor(255, 200, 0)
sh._element.spPr.append(X('<a:effectLst xmlns:a="%s"><a:outerShdw blurRad="76200" dist="76200" dir="2700000" algn="tl" rotWithShape="0"><a:srgbClr val="000000"><a:alpha val="50000"/></a:srgbClr></a:outerShdw><a:glow rad="101600"><a:srgbClr val="FF0000"><a:alpha val="40000"/></a:srgbClr></a:glow></a:effectLst>' % A))
sh.text_frame.text = 'shadow+glow'
sh = s.shapes.add_shape(MSO_SHAPE.OVAL, Inches(11.0), Inches(3.6), Inches(1.6), Inches(1.2))
sh.fill.solid(); sh.fill.fore_color.rgb = RGBColor(120, 200, 120)
sh._element.spPr.append(X('<a:effectLst xmlns:a="%s"><a:softEdge rad="63500"/><a:reflection blurRad="6350" stA="50000" endA="300" endPos="55000" dir="5400000" sy="-100000" algn="bl" rotWithShape="0"/></a:effectLst>' % A))
# lines
for i, (dash, head, tail, w) in enumerate([('dash', None, 'triangle', 3), ('sysDot', 'oval', 'arrow', 2), ('lgDashDot', 'diamond', 'stealth', 4)]):
    c = s.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Inches(0.5), Inches(5.3 + i * 0.5), Inches(4.5), Inches(5.3 + i * 0.5))
    c.line.width = Pt(w); c.line.color.rgb = RGBColor(200, 0, 0)
    ln = c._element.spPr.find(qn('a:ln'))
    ln.append(X('<a:prstDash xmlns:a="%s" val="%s"/>' % (A, dash)))
    if head: ln.append(X('<a:headEnd xmlns:a="%s" type="%s"/>' % (A, head)))
    ln.append(X('<a:tailEnd xmlns:a="%s" type="%s"/>' % (A, tail)))
c = s.shapes.add_connector(MSO_CONNECTOR.ELBOW, Inches(5), Inches(5.2), Inches(7), Inches(6.4))
c.line.width = Pt(3); c.line.color.rgb = RGBColor(0, 0, 200)
ln = c._element.spPr.find(qn('a:ln')); ln.set('cmpd', 'dbl')
# freeform
fb = s.shapes.build_freeform(Inches(7.5), Inches(5.3))
fb.add_line_segments([(Inches(8.5), Inches(5.3)), (Inches(8.9), Inches(6.3)), (Inches(7.9), Inches(6.9)), (Inches(7.2), Inches(6.2))], close=True)
ff = fb.convert_to_shape(); ff.fill.solid(); ff.fill.fore_color.rgb = RGBColor(160, 80, 200); ff.line.color.rgb = RGBColor(0, 0, 0)
# group
g = s.shapes.add_group_shape()
a = g.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(9.5), Inches(5.3), Inches(1.5), Inches(1))
a.fill.solid(); a.fill.fore_color.rgb = RGBColor(255, 100, 100)
b = g.shapes.add_shape(MSO_SHAPE.OVAL, Inches(10.3), Inches(5.9), Inches(1.5), Inches(1))
b.fill.solid(); b.fill.fore_color.rgb = RGBColor(100, 100, 255)
# picture fill shape + pictures
sh = s.shapes.add_picture(OUT + '/a.png', Inches(11.9), Inches(5.3), Inches(1.2), Inches(0.8))
sh.crop_left = 0.2; sh.crop_right = 0.1; sh.crop_top = 0.1
sh.line.color.rgb = RGBColor(0, 100, 0); sh.line.width = Pt(3)
pic = s.shapes.add_picture(OUT + '/b.png', Inches(11.9), Inches(6.2), Inches(1.0), Inches(1.0))
pic._element.spPr.find(qn('a:prstGeom')).set('prst', 'ellipse')
pic._element.blipFill.find(qn('a:blip')).append(X('<a:grayscl xmlns:a="%s"/>' % A))
# slide 2 background gradient + picture slide
s = blank(p)
bg = s.background.fill
bg.gradient(); bg.gradient_angle = 90
bg.gradient_stops[0].color.rgb = RGBColor(10, 30, 80); bg.gradient_stops[1].color.rgb = RGBColor(80, 150, 220)
t = tb(s, 1, 1, 8, 1.5, 'White on gradient background', 36)
t.text_frame.paragraphs[0].runs[0].font.color.rgb = RGBColor(255, 255, 255)
# 3-D
sh = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(1), Inches(3), Inches(3), Inches(2))
sh.fill.solid(); sh.fill.fore_color.rgb = RGBColor(250, 190, 50)
sh._element.spPr.append(X('<a:scene3d xmlns:a="%s"><a:camera prst="orthographicFront"><a:rot lat="1200000" lon="1800000" rev="0"/></a:camera><a:lightRig rig="threePt" dir="t"/></a:scene3d>' % A))
sh._element.spPr.append(X('<a:sp3d xmlns:a="%s" extrusionH="190500"><a:bevelT w="127000" h="127000" prst="circle"/></a:sp3d>' % A))
sh.text_frame.text = '3-D rotation + bevel'
p.save(OUT + '/shapes169.pptx')

# ───────── 3 tables ─────────
p = new(True)
s = blank(p)
gf = s.shapes.add_table(4, 4, Inches(0.6), Inches(0.6), Inches(8), Inches(3))
tbl = gf.table
for r in range(4):
    for c in range(4):
        tbl.cell(r, c).text = 'R%dC%d' % (r, c)
tbl.cell(0, 0).merge(tbl.cell(0, 1))
tbl.cell(1, 0).merge(tbl.cell(2, 0))
tbl.cell(0, 0).text = 'Merged header'
tbl.cell(3, 3).fill.solid(); tbl.cell(3, 3).fill.fore_color.rgb = RGBColor(255, 220, 100)
tbl.cell(3, 2).text_frame.paragraphs[0].runs[0].font.bold = True
tbl.cell(3, 2).text_frame.paragraphs[0].runs[0].font.color.rgb = RGBColor(200, 0, 0)
tbl.cell(3, 1).text_frame.paragraphs[0].alignment = PP_ALIGN.RIGHT
tbl.columns[0].width = Inches(1.5)
# explicit borders on a cell
tcPr = tbl.cell(2, 3)._tc.get_or_add_tcPr()
for side in ('lnL', 'lnR', 'lnT', 'lnB'):
    tcPr.insert(0, X('<a:%s xmlns:a="%s" w="38100"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:%s>' % (side, A, side)))
# second table, a different style id (Medium Style 4 - Accent 2)
gf2 = s.shapes.add_table(3, 3, Inches(0.6), Inches(4.4), Inches(6), Inches(2))
gf2._element.graphic.graphicData.tbl.tblPr.find(qn('a:tableStyleId')).text = '{00A15C55-8517-42AA-B614-E9B94910E393}'
for r in range(3):
    for c in range(3):
        gf2.table.cell(r, c).text = 'v%d%d' % (r, c)
p.save(OUT + '/tables169.pptx')

# ───────── 4 charts ─────────
p = new(True)
def chart_slide(ctype, data, title, x=0.5, y=0.5, w=6, h=3.4, legend=True, s=None, labels=False):
    gf = s.shapes.add_chart(ctype, Inches(x), Inches(y), Inches(w), Inches(h), data)
    ch = gf.chart
    ch.has_title = True; ch.chart_title.text_frame.text = title
    ch.has_legend = legend
    if legend: ch.legend.position = XL_LEGEND_POSITION.BOTTOM; ch.legend.include_in_layout = False
    if labels:
        ch.plots[0].has_data_labels = True
    return ch
cd = CategoryChartData(); cd.categories = ['Q1', 'Q2', 'Q3', 'Q4']
cd.add_series('East', (20.4, 27.4, 90, 20.4)); cd.add_series('West', (30.6, 38.6, 34.6, 31.6))
s = blank(p)
chart_slide(XL_CHART_TYPE.COLUMN_CLUSTERED, cd, 'Clustered columns', s=s, labels=True)
chart_slide(XL_CHART_TYPE.LINE_MARKERS, cd, 'Line markers', x=6.8, s=s)
chart_slide(XL_CHART_TYPE.BAR_STACKED, cd, 'Stacked bar', y=4, s=s)
chart_slide(XL_CHART_TYPE.AREA, cd, 'Area', x=6.8, y=4, s=s)
s = blank(p)
cd2 = CategoryChartData(); cd2.categories = ['Alpha', 'Beta', 'Gamma']; cd2.add_series('Share', (50, 30, 20))
chart_slide(XL_CHART_TYPE.PIE, cd2, 'Pie', s=s, labels=True)
chart_slide(XL_CHART_TYPE.DOUGHNUT, cd2, 'Doughnut', x=6.8, s=s)
xy = XyChartData(); ser = xy.add_series('Pts')
for a_, b_ in [(1, 2), (2, 4), (3, 3), (4, 7)]: ser.add_data_point(a_, b_)
chart_slide(XL_CHART_TYPE.XY_SCATTER, xy, 'Scatter', y=4, s=s)
cd3 = CategoryChartData(); cd3.categories = ['A', 'B', 'C', 'D', 'E']; cd3.add_series('S1', (3, 5, 2, 6, 4))
chart_slide(XL_CHART_TYPE.RADAR, cd3, 'Radar', x=6.8, y=4, s=s)
p.save(OUT + '/charts169.pptx')

# ───────── 5 package features (notes, hidden, transitions, animations, comments, sections, media) ─────────
p = new()
s1 = blank(p); tb(s1, 1, 1, 8, 1, 'Slide with notes and fade transition', 28)
s1.notes_slide.notes_text_frame.text = 'These are the speaker notes.\nSecond line of notes.'
s2 = blank(p); tb(s2, 1, 1, 8, 1, 'Hidden slide', 28); s2._element.set('show', '0')
s3 = blank(p); a1 = tb(s3, 1, 1, 8, 1, 'Animated: fade on click', 28); a2 = tb(s3, 1, 2.5, 8, 1, 'Fly in with previous', 28)
a3 = tb(s3, 1, 4, 8, 1, 'Appear after previous', 28)
s4 = blank(p); l = tb(s4, 1, 1, 6, 1, 'Link to slide 1', 28)
l.text_frame.paragraphs[0].runs[0].hyperlink.address = 'https://example.org/page'
tb(s4, 1, 3, 6, 1, 'Slide jump text', 28)
# slide-jump hyperlink on shape
sh = s4.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(1), Inches(4.5), Inches(3), Inches(1)); sh.text_frame.text = 'Go to slide 1'
rid = s4.part.relate_to(s1.part, 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide')
cNvPr = sh._element.nvSpPr.cNvPr
cNvPr.append(X('<a:hlinkClick xmlns:a="%s" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="%s" action="ppaction://hlinksldjump"/>' % (A, rid)))
P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
def transition(slide, inner, attrs=''):
    t = X('<p:transition xmlns:p="%s" spd="med" %s>%s</p:transition>' % (P, attrs, inner))
    cs = slide._element.find(qn('p:clrMapOvr'))
    (cs if cs is not None else slide._element.find(qn('p:cSld'))).addnext(t)
transition(s1, '<p:fade/>')
transition(s3, '<p:push dir="u"/>', 'advTm="3000"')
transition(s4, '<p:wipe dir="l"/>', 'advClick="0"')
def timing(slide, items):
    # items: list of (spid, presetID, cls, subtype, nodeType)
    pars = ''
    ctn = 3
    for spid, pid, cls, sub, node in items:
        if node == 'clickEffect':
            pars += '<p:par><p:cTn id="%d" fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst><p:par><p:cTn id="%d" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>' % (ctn, ctn + 1)
            ctn += 2; open_ = True
        pars += '<p:par><p:cTn id="%d" presetID="%d" presetClass="%s" presetSubtype="%d" fill="hold" nodeType="%s"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst><p:set><p:cBhvr><p:cTn id="%d" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn><p:tgtEl><p:spTgt spid="%d"/></p:tgtEl><p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set><p:animEffect transition="in" filter="fade"><p:cBhvr><p:cTn id="%d" dur="500"/><p:tgtEl><p:spTgt spid="%d"/></p:tgtEl></p:cBhvr></p:animEffect></p:childTnLst></p:cTn></p:par>' % (ctn, pid, cls, sub, node, ctn + 1, spid, ctn + 2, spid)
        ctn += 3
        if node != 'clickEffect' and False: pass
    # close click pars: simple approach - every click effect closes at the end of its group; here we close all at end
    nclick = sum(1 for i in items if i[4] == 'clickEffect')
    pars += '</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>' * nclick
    xml = '<p:timing xmlns:p="%s"><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst><p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>%s</p:childTnLst></p:cTn><p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst><p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>' % (P, pars)
    slide._element.append(X(xml))
# click: fade (10) on a1, with: fly(2) on a2, then click appear(1) on a3
timing(s3, [(a1.shape_id, 10, 'entr', 0, 'clickEffect'), (a2.shape_id, 2, 'entr', 4, 'withEffect'), (a3.shape_id, 1, 'entr', 0, 'clickEffect')])
# comments (legacy)
cm_authors = '<p:cmAuthorLst xmlns:p="%s"><p:cmAuthor id="0" name="Tester" initials="T" lastIdx="1" clrIdx="0"/></p:cmAuthorLst>' % P
cm = '<p:cmLst xmlns:p="%s"><p:cm authorId="0" dt="2026-01-02T03:04:05.000" idx="1"><p:pos x="10" y="10"/><p:text>Please check this slide.</p:text></p:cm></p:cmLst>' % P
from pptx.opc.package import Part
from pptx.opc.packuri import PackURI
pk = p.part.package
authors_part = Part(PackURI('/ppt/commentAuthors.xml'), 'application/vnd.openxmlformats-officedocument.presentationml.commentAuthors+xml', pk, cm_authors.encode())
p.part.relate_to(authors_part, 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/commentAuthors')
cm_part = Part(PackURI('/ppt/comments/comment1.xml'), 'application/vnd.openxmlformats-officedocument.presentationml.comments+xml', pk, cm.encode())
s1.part.relate_to(cm_part, 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments')
# sections
ids = [sid.get('id') for sid in p.part._element.sldIdLst]
sec = '<p:extLst xmlns:p="%s"><p:ext uri="{521415D9-36F7-43E2-AB2F-B90AF26B5E84}"><p14:sectionLst xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main"><p14:section name="Intro" id="{11111111-1111-1111-1111-111111111111}"><p14:sldIdLst><p14:sldId id="%s"/><p14:sldId id="%s"/></p14:sldIdLst></p14:section><p14:section name="Body" id="{22222222-2222-2222-2222-222222222222}"><p14:sldIdLst><p14:sldId id="%s"/><p14:sldId id="%s"/></p14:sldIdLst></p14:section></p14:sectionLst></p:ext></p:extLst>' % ((P,) + tuple(ids))
p.part._element.append(X(sec))
# audio / video: tiny placeholder media with poster picture
vid = s4.shapes.add_movie if hasattr(s4.shapes, 'add_movie') else None
open(OUT + '/clip.mp4', 'wb').write(b'\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom' + b'\x00' * 200)
s5 = blank(p); tb(s5, 1, 0.5, 8, 1, 'Video with poster frame', 28)
s5.shapes.add_movie(OUT + '/clip.mp4', Inches(1), Inches(1.8), Inches(4), Inches(3), poster_frame_image=OUT + '/a.png', mime_type='video/mp4')
p.save(OUT + '/features43.pptx')

# ───────── 6 master/layout inheritance ─────────
p = new(True)
master = p.slide_master
# master background gradient + logo shape + title style
cSld = master._element.find(qn('p:cSld'))
bg = X('<p:bg xmlns:p="%s" xmlns:a="%s"><p:bgPr><a:gradFill xmlns:a="%s"><a:gsLst><a:gs pos="0"><a:srgbClr val="FFF4D6"/></a:gs><a:gs pos="100000"><a:srgbClr val="F5C26B"/></a:gs></a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill><a:effectLst/></p:bgPr></p:bg>' % (P, A, A))
old = cSld.find(qn('p:bg'))
if old is not None: cSld.remove(old)
cSld.insert(0, bg)
ts = master._element.find(qn('p:txStyles')).find(qn('p:titleStyle')).find(qn('a:lvl1pPr'))
ts.set('algn', 'l')
d = ts.find(qn('a:defRPr')); d.set('sz', '4000'); d.set('b', '1')
for e in d.findall(qn('a:solidFill')): d.remove(e)
d.insert(0, X('<a:solidFill xmlns:a="%s"><a:srgbClr val="7A1F1F"/></a:solidFill>' % A))
body = master._element.find(qn('p:txStyles')).find(qn('p:bodyStyle')).find(qn('a:lvl1pPr'))
bd = body.find(qn('a:defRPr')); bd.set('sz', '2400')
for e in bd.findall(qn('a:solidFill')): bd.remove(e)
bd.insert(0, X('<a:solidFill xmlns:a="%s"><a:srgbClr val="1F3A7A"/></a:solidFill>' % A))
logo_xml = '<p:sp xmlns:p="%s" xmlns:a="%s"><p:nvSpPr><p:cNvPr id="99" name="Logo"/><p:cNvSpPr/><p:nvPr userDrawn="1"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="11155680" y="182880"/><a:ext cx="731520" cy="731520"/></a:xfrm><a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="7A1F1F"/></a:solidFill></p:spPr><p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US" sz="1200"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>LOGO</a:t></a:r></a:p></p:txBody></p:sp>' % (P, A)
cSld.find(qn('p:spTree')).append(X(logo_xml))
# fix master/layout placeholder geometry for 16:9 (scale x)
def widen(shapes):
    for sh in shapes:
        if sh.is_placeholder and sh.left is not None:
            l, t, w, h = sh.left, sh.top, sh.width, sh.height
            sh.left = int(l * 1.3333); sh.width = int(w * 1.3333); sh.top = t; sh.height = h
widen(master.placeholders)
for lay in p.slide_layouts: widen(lay.placeholders)
s = p.slides.add_slide(p.slide_layouts[1])
s.shapes.title.text = 'Master styled title (left, bold, dark red)'
tf = s.placeholders[1].text_frame; tf.text = 'Body text takes the master colour and 24pt'
pa = tf.add_paragraph(); pa.text = 'Second level'; pa.level = 1
s = p.slides.add_slide(p.slide_layouts[0])
s.shapes.title.text = 'Title slide layout'
s.placeholders[1].text = 'Subtitle'
# footer / date / slide number placeholders on a slide
s = p.slides.add_slide(p.slide_layouts[1]); s.shapes.title.text = 'Footer placeholders'
s.placeholders[1].text = 'Body'
p.save(OUT + '/master169.pptx')
print('ok')
