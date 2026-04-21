<p align="center"><a href="CONTRIBUTING.md">English</a> | <a href="CONTRIBUTING.zh.md">简体中文</a> | <a href="CONTRIBUTING.zht.md">繁體中文</a> | <a href="CONTRIBUTING.ko.md">한국어</a> | <a href="CONTRIBUTING.de.md">Deutsch</a> | <a href="CONTRIBUTING.es.md">Español</a> | <a href="CONTRIBUTING.fr.md">Français</a> | <a href="CONTRIBUTING.it.md">Italiano</a> | <a href="CONTRIBUTING.da.md">Dansk</a> | <a href="CONTRIBUTING.ja.md">日本語</a> | <a href="CONTRIBUTING.pl.md">Polski</a> | <a href="CONTRIBUTING.ru.md">Русский</a> | <a href="CONTRIBUTING.bs.md">Bosanski</a> | <a href="CONTRIBUTING.ar.md">العربية</a> | <a href="CONTRIBUTING.no.md">Norsk</a> | <a href="CONTRIBUTING.br.md">Português (Brasil)</a> | <b>ไทย</b> | <a href="CONTRIBUTING.tr.md">Türkçe</a> | <a href="CONTRIBUTING.uk.md">Українська</a> | <a href="CONTRIBUTING.bn.md">বাংলা</a> | <a href="CONTRIBUTING.gr.md">Ελληνικά</a> | <a href="CONTRIBUTING.vi.md">Tiếng Việt</a></p>

# การมีส่วนร่วมกับ OpenCode

เราต้องการทำให้คุณมีส่วนร่วมกับ OpenCode ได้ง่าย นี่คือประเภทการเปลี่ยนแปลงที่มักถูก merge:

- การแก้ไขบัก
- LSP / ตัวจัดรูปแบบเพิ่มเติม
- การปรับปรุงประสิทธิภาพ LLM
- การสนับสนุนผู้ให้บริการใหม่
- การแก้ไขปัญหาเฉพาะสภาพแวดล้อม
- พฤติกรรมมาตรฐานที่ขาดหายไป
- การปรับปรุงเอกสาร

อย่างไรก็ตาม คุณสมบัติ UI หรือผลิตภัณฑ์หลักใด ๆ จะต้องผ่านการตรวจสอบการออกแบบกับทีมหลักก่อนการใช้งาน

## ความคาดหวังสำหรับ Pull Requests

### นโยบาย Issue ก่อน

**PR ทั้งหมดต้องอ้างอิงถึง issue ที่มีอยู่** ก่อนเปิด PR ให้เปิด issue ที่อธิบายบักหรือคุณลักษณะ สิ่งนี้ช่วยให้ผู้ดูแลทำ triage และป้องกันการทำงานซ้ำซ้อน PR ที่ไม่มี issue ที่เชื่อมโยงอาจถูกปิดโดยไม่มีการตรวจสอบ

### ห้ามกำแพงข้อความที่ AI สร้าง

คำอธิบาย PR และ issues ที่ยาวและสร้างโดย AI ไม่เป็นที่ยอมรับและอาจถูกละเลย เคารพเวลาของผู้ดูแล:

- เขียนคำอธิบายสั้น ๆ และมีจุดโฟกัส
- อธิบายสิ่งที่เปลี่ยนแปลงและเหตุผลด้วยคำพูดของคุณเอง
- หากคุณอธิบายไม่สั้น PR ของคุณอาจใหญ่เกินไป

### ชื่อ PR

ชื่อ PR ควรเป็นไปตามมาตรฐาน conventional commit: `feat:` คุณลักษณะใหม่, `fix:` แก้ไขบัก, `docs:` เอกสาร, `chore:` การบำรุงรักษา, `refactor:` รีแฟกเตอร์, `test:` การทดสอบ

---

สำหรับรายละเอียดทั้งหมดเกี่ยวกับการตั้งค่าสภาพแวดล้อมการพัฒนา คำสั่ง build และการกำหนดค่าดีบักเกอร์ โปรดดูต้นฉบับภาษาอังกฤษ [CONTRIBUTING.md](CONTRIBUTING.md)
