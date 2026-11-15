# Builds anim2.pptx: fly in/out, zoom, spin, emphasis, exit and motion path effects, with repeat and an on-click trigger.
# PowerPoint's own timing XML (python-pptx cannot write animations); LibreOffice converts it to .odp.
import re, sys
from pptx import Presentation
from pptx.util import Inches
from pptx.enum.shapes import MSO_SHAPE
from lxml import etree
P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
prs = Presentation(); prs.slide_width = Inches(10); prs.slide_height = Inches(7.5)
s = prs.slides.add_slide(prs.slide_layouts[6])
ids = []
for i in range(14):
    sh = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.3 + (i % 7) * 1.3), Inches(1 + (i // 7) * 2), Inches(1), Inches(1)); sh.name = f'Box {i}'; ids.append(sh.shape_id)

def tgt(spid): return f'<p:tgtEl><p:spTgt spid="{spid}"/></p:tgtEl>'
def vis(spid, v, delay=0): return f'<p:set><p:cBhvr><p:cTn id="{{n}}" dur="1" fill="hold"><p:stCondLst><p:cond delay="{delay}"/></p:stCondLst></p:cTn>{tgt(spid)}<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="{v}"/></p:to></p:set>'
def anim(spid, attr, a, b, dur=500):
    return f'<p:anim calcmode="lin" valueType="num"><p:cBhvr additive="base"><p:cTn id="{{n}}" dur="{dur}" fill="hold"/>{tgt(spid)}<p:attrNameLst><p:attrName>{attr}</p:attrName></p:attrNameLst></p:cBhvr><p:tavLst><p:tav tm="0"><p:val><p:strVal val="{a}"/></p:val></p:tav><p:tav tm="100000"><p:val><p:strVal val="{b}"/></p:val></p:tav></p:tavLst></p:anim>'
def fx(spid, filt, tr='in', dur=500): return f'<p:animEffect transition="{tr}" filter="{filt}"><p:cBhvr><p:cTn id="{{n}}" dur="{dur}"/>{tgt(spid)}</p:cBhvr></p:animEffect>'
def eff(preset, cls, sub, node, delay, body, rep=None):
    r = f' repeatCount="{rep}"' if rep else ''
    return f'<p:par><p:cTn id="{{n}}" presetID="{preset}" presetClass="{cls}" presetSubtype="{sub}" fill="hold" nodeType="{node}"{r}><p:stCondLst><p:cond delay="{delay}"/></p:stCondLst><p:childTnLst>{body}</p:childTnLst></p:cTn></p:par>'
def click(inner): return f'<p:par><p:cTn id="{{n}}" fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst><p:par><p:cTn id="{{n}}" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>{inner}</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>'
def flyin(i, sub, attr, frm, to): return eff(2, 'entr', sub, 'clickEffect', 0, vis(ids[i], 'visible') + anim(ids[i], attr, frm, to))
def flyout(i, sub, attr, frm, to): return eff(2, 'exit', sub, 'clickEffect', 0, anim(ids[i], attr, frm, to) + vis(ids[i], 'hidden', 500))
def zoom(i, cls, vis_v): return eff(53, cls, 16, 'clickEffect', 0, vis(ids[i], vis_v) + anim(ids[i], 'ppt_w', '0' if cls == 'entr' else '#ppt_w', '#ppt_w' if cls == 'entr' else '0') + anim(ids[i], 'ppt_h', '0' if cls == 'entr' else '#ppt_h', '#ppt_h' if cls == 'entr' else '0') + fx(ids[i], 'fade', 'in' if cls == 'entr' else 'out'))
def spin(i): return eff(8, 'emph', 0, 'clickEffect', 0, f'<p:animRot by="21600000"><p:cBhvr><p:cTn id="{{n}}" dur="2000" fill="hold"/>{tgt(ids[i])}<p:attrNameLst><p:attrName>r</p:attrName></p:attrNameLst></p:cBhvr></p:animRot>')
def grow(i): return eff(6, 'emph', 0, 'withEffect', 0, f'<p:animScale><p:cBhvr><p:cTn id="{{n}}" dur="2000" fill="hold"/>{tgt(ids[i])}</p:cBhvr><p:by x="150000" y="150000"/></p:animScale>')
def pulse(i): return eff(26, 'emph', 0, 'clickEffect', 0, f'<p:animScale><p:cBhvr><p:cTn id="{{n}}" dur="500" autoRev="1" fill="hold"/>{tgt(ids[i])}</p:cBhvr><p:by x="105000" y="105000"/></p:animScale>', rep=3000)
def colorchange(i): return eff(19, 'emph', 0, 'clickEffect', 0, f'<p:animClr clrSpc="rgb" dir="cw"><p:cBhvr override="childStyle"><p:cTn id="{{n}}" dur="500" fill="hold"/>{tgt(ids[i])}<p:attrNameLst><p:attrName>fillcolor</p:attrName></p:attrNameLst></p:cBhvr><p:to><a:srgbClr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" val="FF0000"/></p:to></p:animClr>')
def boldflash(i): return eff(35, 'emph', 0, 'clickEffect', 0, f'<p:set><p:cBhvr><p:cTn id="{{n}}" dur="500" fill="hold"/>{tgt(ids[i])}<p:attrNameLst><p:attrName>style.fontWeight</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="bold"/></p:to></p:set>')
def motion(i, path): return eff(0, 'path', 0, 'clickEffect', 0, f'<p:animMotion origin="layout" path="{path}" pathEditMode="relative" ptsTypes=""><p:cBhvr><p:cTn id="{{n}}" dur="2000" fill="hold"/>{tgt(ids[i])}<p:attrNameLst><p:attrName>ppt_x</p:attrName><p:attrName>ppt_y</p:attrName></p:attrNameLst></p:cBhvr></p:animMotion>')
steps = ''.join(click(e) for e in [
    flyin(0, 8, 'ppt_x', '0-#ppt_w/2', '#ppt_x'),
    flyin(1, 1, 'ppt_y', '0-#ppt_h/2', '#ppt_y'),
    flyin(2, 2, 'ppt_x', '1+#ppt_w/2', '#ppt_x'),
    flyout(3, 8, 'ppt_x', '#ppt_x', '0-#ppt_w/2'),
    flyout(4, 4, 'ppt_y', '#ppt_y', '1+#ppt_h/2'),
    zoom(5, 'entr', 'visible'),
    zoom(6, 'exit', 'hidden'),
    spin(7) + grow(8),
    pulse(9),
    colorchange(10),
    boldflash(11),
    motion(12, 'M 0 0 L 0.25 0.1 E'),
])
# A trigger: clicking Box 13 plays a spin on Box 0 outside the slide's clicks.
trig = (f'<p:seq concurrent="1" nextAc="seek"><p:cTn id="{{n}}" restart="whenNotActive" fill="hold" evtFilter="cancelBubble" nodeType="interactiveSeq"><p:stCondLst><p:cond evt="onClick" delay="0"><p:tgtEl><p:spTgt spid="{ids[13]}"/></p:tgtEl></p:cond></p:stCondLst><p:endSync evt="end" delay="0"><p:rtn val="all"/></p:endSync><p:childTnLst>'
        + '<p:par><p:cTn id="{n}" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst><p:par><p:cTn id="{n}" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>'
        + eff(8, 'emph', 0, 'clickEffect', 0, f'<p:animRot by="21600000"><p:cBhvr><p:cTn id="{{n}}" dur="1000" fill="hold"/>{tgt(ids[0])}<p:attrNameLst><p:attrName>r</p:attrName></p:attrNameLst></p:cBhvr></p:animRot>')
        + '</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn>'
        + f'<p:nextCondLst><p:cond evt="onClick" delay="0"><p:tgtEl><p:spTgt spid="{ids[13]}"/></p:tgtEl></p:cond></p:nextCondLst></p:seq>')
xml = (f'<p:timing xmlns:p="{P}"><p:tnLst><p:par><p:cTn id="{{n}}" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>'
       f'<p:seq concurrent="1" nextAc="seek"><p:cTn id="{{n}}" dur="indefinite" nodeType="mainSeq"><p:childTnLst>{steps}</p:childTnLst></p:cTn>'
       f'<p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst><p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq>'
       f'{trig}</p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>')
n = [0]
def num(m): n[0] += 1; return str(n[0])
s._element.append(etree.fromstring(re.sub(r'\{n\}', num, xml)))
prs.save(sys.argv[1])
