# Škola

Osobní appka na studium (předměty, termíny, materiály, vyřešené leaflety). Běží jako web na GitHub Pages
a jde ji přidat na plochu telefonu.

**V tomto repu nejsou žádná data.** Stránka obsahuje jen aplikaci. Po přihlášení přes Google si stáhne
soubor „Škola ESF – data.json“ z Google Disku přihlášeného uživatele (oprávnění `drive.file`: appka vidí
jen soubor, který sama vytvořila), uloží ho do zařízení a funguje i offline. Bez přihlášení se nezobrazí nic.

Odhlášení v appce (ikona účtu) smaže data ze zařízení a zruší přístup.

## Sdílení předmětů

U každého předmětu je tlačítko **Kopírovat odkaz**. Odkaz nese celý předmět (termíny, podmínky, materiály, leaflety
i rozvrh) kromě **mých bodů a docházky z poznámkových bloků**; data jsou v části za `#`, která se nikdy neposílá na server.
Kdo odkaz otevře, předmět se mu uloží jen do jeho zařízení a přidá se do appky, přihlášení nepotřebuje. Další odkaz
přidá další předmět; stejný předmět poslaný znovu se aktualizuje. Příjemce nikdy nenahrává žádný soubor. Odkazy nad ~4000 znaků
useknou Telegram a Discord; WhatsApp, iMessage, Signal a e-mail je unesou.

Obsah odkazu je cizí vstup, proto se při příjmu přestaví čistá kopie (`cleanBundle` v `index.html`): povolené tvary
polí, bezpečná id, ikony jen jako jednoduché SVG tvary.

