import sys
from pptx import Presentation
from pptx.util import Inches
from lxml import etree
P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
prs = Presentation(); prs.slide_width = Inches(13.333); prs.slide_height = Inches(7.5)
trs = [
    '<p:transition spd="slow"><p:push dir="u"/></p:transition>',
    '<p:transition spd="fast"><p:wipe dir="r"/></p:transition>',
    '<p:transition spd="med"><p:cover dir="ld"/></p:transition>',
    '<p:transition spd="med"><p:pull dir="r"/></p:transition>',
    '<p:transition spd="med"><p:split orient="vert" dir="in"/></p:transition>',
    '<p:transition spd="med"><p:blinds dir="vert"/></p:transition>',
    '<p:transition spd="med"><p:fade/></p:transition>',
]
for t in trs:
    s = prs.slides.add_slide(prs.slide_layouts[6])
    s._element.append(etree.fromstring(t.replace('<p:transition', f'<p:transition xmlns:p="{P}"', 1)))
prs.save(sys.argv[1])
