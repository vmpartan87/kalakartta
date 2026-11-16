# Kalakartta – Iitin–Jaalan vedet

Puhelimeen asennettava verkkosovellus (PWA) kuhan, ahvenen, hauen ja kirjolohen kalastukseen Iitin Pyhäjärvellä, Pelinginselällä ja Kymijoen vesillä Jaalaan asti, Mankalan voimalaitoksen kirjolohivedet mukaan lukien.

- **Syvyyskartta** Syken avoimesta syvyysaineistosta: syvyysalueet, -käyrät ja luotauspisteet. Napauta karttaa nähdäksesi syvyyden.
- **Ottipaikat**: *Lisää ottipaikat* -napilla sovellus laskee näkyvältä kartta-alueelta valittujen lajien parhaat kohdat syvyysaineiston (pudotusreunat, matalikot, syvänteet, virta) ja vuodenajan perusteella. Pallukat numeroidaan ylhäältä alas ja vasemmalta oikealle, ja jokaisen perustelu näkyy napauttamalla tai Paikat-välilehdellä.
- **Taustakartta**: Maanmittauslaitoksen maastokartta, taustakartta, selkokartta tai ilmakuva (API-avain on tiedostossa `js/config.js`; laitekohtaisen oman avaimen voi asettaa Aineisto-välilehdellä).
- **Kalapaikat**: omat paikat ja kymmenen valmista ehdotusta (myös Mankalan voimalaitoksen edusta), jotka sijoitetaan kartalle.
- **Ennuste**: tuntikohtainen kalaonni-arvio (0–100) kuhalle, ahvenelle, hauelle ja kirjolohelle kymmeneksi päiväksi, sekä viikon parhaat ajat.
- **Saaliskirja**: jokaiseen saaliiseen tallentuu sää, paine ja mallin arvio, ja kirjaukset saa CSV-tiedostona.
- Toimii ilman verkkoa, kun sovellus ja aineisto on kerran ladattu.

Kaikki tiedot (paikat, saaliit) tallentuvat vain laitteelle, eikä sovelluksella ole palvelinta.

## Julkaisu GitHub Pagesiin

1. Luo repositorio ja vie tämän kansion sisältö sen juureen.
2. Avaa repositorion **Settings → Pages**, valitse *Deploy from a branch* ja haara `main` / kansio `/ (root)`.
3. Avaa annettu osoite puhelimella ja valitse selaimen valikosta **Lisää kotivalikkoon** (iPhone: Safari → Jaa → Lisää Koti-valikkoon).

Paikallinen testaus: `python3 -m http.server` kansiossa, tai Windowsissa ilman asennuksia `powershell -ExecutionPolicy Bypass -File tools\palvelin.ps1`, ja selaimella `http://localhost:8000`. Pelkkä tiedoston avaaminen ei riitä, koska moduulit ja service worker tarvitsevat palvelimen.

## Syvyysaineiston lisääminen

Syke julkaisee koko Suomen syvyysaineistot avoimena datana (CC BY 4.0, ETRS-TM35FIN):

- [syvyysalue.zip](https://wwwd3.ymparisto.fi/d3/gis_data/spesific/syvyysalue.zip): syvyysalueet
- [syvyyskayra.zip](https://wwwd3.ymparisto.fi/d3/gis_data/spesific/syvyyskayra.zip): syvyyskäyrät
- [luotauspisteet.zip](https://wwwd3.ymparisto.fi/d3/gis_data/spesific/luotauspisteet.zip): luotauspisteet
- [ranta10jarvet.zip](https://wwwd3.ymparisto.fi/d3/gis_data/spesific/ranta10jarvet.zip): järvien rantaviiva (valinnainen, iso)
- [ranta10joet.zip](https://wwwd3.ymparisto.fi/d3/gis_data/spesific/ranta10joet.zip): jokien rantaviiva, Kymijoen jokiosuudet kuten Kaurakoski (valinnainen)

**Suositeltu tapa:** rajaa aineisto kerran tietokoneella, jolloin se näkyy kaikilla laitteilla:

```bash
pip install pyshp
python tools/rajaa_syke.py syvyysalue.zip syvyyskayra.zip luotauspisteet.zip ranta10jarvet.zip ranta10joet.zip
git add data && git commit -m "Syvyysaineisto" && git push
```

Skripti kirjoittaa `data/*.json`-tiedostot ja `data/layers.json`-luettelon. Se tulostaa jokaisen tason tyypin ja syvyyskentän; jos arvaus menee väärin, korjaa ne `layers.json`-tiedostoon tai anna valinnat `--kind nimi=alueet` ja `--depth nimi=KENTTA,KENTTA2`. Jos aineistossa ei ole alueen kohteita, skripti kertoo sen.

**Windows ilman Pythonia:** sama rajaus toimii Windowsin omalla PowerShellillä:

```
powershell -ExecutionPolicy Bypass -File tools\rajaa_syke.ps1 syvyysalue.zip syvyyskayra.zip luotauspisteet.zip ranta10jarvet.zip ranta10joet.zip
```

Syke tallentaa syvyysalueiden ja -käyrien syvyyden tekstinä (esim. `0-1,5`); PowerShell-skripti muuntaa sen numeerisiksi kentiksi `syv_min` ja `syv_max`. Repon `data/`-kansio on rajattu tällä skriptillä.

**Vaihtoehto:** Aineisto-välilehdellä zip-tiedostot voi rajata suoraan selaimessa, mutta ne tallentuvat vain kyseiselle laitteelle, ja isot paketit voivat olla puhelimelle liikaa.

Rajausalue on `js/app.js`-tiedoston `REGION_DEFAULT`-vakio ja skriptin `BBOX`.

## Miten ennuste lasketaan

Malli on läpinäkyvä sääntöpohjainen arvio, ei mitatusta aineistosta opetettu. Jokainen tekijä saa arvon 0–1, ja painotettu keskiarvo skaalataan 0–100. Sovellus näyttää jokaisen tekijän osuuden ja perustelun.

| Tekijä | Paino | Peruste | Näytön vahvuus |
|---|---|---|---|
| Veden lämpötila | 25 | Lajikohtainen käyrä. Kuha viihtyy 16–24 °C:ssa ja on kylmässä vedessä hidas. Ahven syö laajalla lämpöalueella, myös talvella. Hauki on parhaimmillaan 12–19 °C:ssa ja syö kylmässäkin. Kirjolohi on kylmän veden kala (paras 11–16 °C) ja syö huonosti yli 20 °C:ssa. | Vahva |
| Valo ja kellonaika | 25 | Kuha ja kirjolohi ovat aktiivisimmillaan hämärässä ja välttävät kirkasta päivää (pilvisyys ja aallokko auttavat). Ahven ja hauki ovat päiväsaalistajia, huiput aamulla ja illalla. | Vahva |
| Ilmanpaine | 12 | Tasaisesti laskeva paine ennen rintamaa hyvä, nopeasti nouseva paine rintaman jälkeen huono. | Heikko |
| Tuuli | 10 | Kuhalle 3–8 m/s aallokko hyvä; kova tuuli huono molemmille. | Kohtalainen |
| Sade | 10 | Heikko sade ja pilvisyys hyviä, rankkasade ja ukkonen huonoja. | Kohtalainen |
| Istutus (kirjolohi) | 15 | Istutuksen jälkeiset 3 viikkoa parhaita, sen jälkeen saalis heikkenee noin kahden kuukauden aikana. Vain jos istutuspäivä on syötetty. | Vahva |
| Kalakalenteri | 8 | Solunaariteoria: kuun ylä- ja alakulminaatio ±1 h (suuret jaksot), kuunnousu ja -lasku ±30 min (pienet), uusi- ja täysikuu vahvistavat. | Heikko |

Lisäksi sovellus huomioi kutuajat (kuha, ahven ja hauki; kuhan ja hauen kutuaikana arvio laskee ja sovellus muistuttaa vapauttamisesta), jääajan sekä puuskien ja ukkosen turvallisuusvaroitukset.

**Kirjolohesta:** Mankalan voimalaitoksen edusta on virtapaikka, jossa voimalaitoksen juoksutus vaikuttaa syöntiin. Juoksutustietoa ei ole mallissa. Virtapaikoilla ja istutusalueilla on usein omat lupansa ja sääntönsä, jotka kannattaa tarkistaa ennen kalastusta.

**Ilmanpaineesta:** kalastajien kokemus painottaa paineen *muutosta* eikä sen tasoa. Kontrolloiduissa tutkimuksissa suoraa vaikutusta ei kuitenkaan ole juuri löydetty: ilmanpaineen vaihtelu on kalalle pieni verrattuna paineen muutokseen, kun se ui metrin syvemmälle. Todennäköisesti paine toimii merkkinä muista asioista (pilvisyys, tuuli, valo, lämpötila), joten paino on pieni.

**Kalakalenterista:** perinteinen ja suosittu, mutta tutkimuksissa vaikutus on ollut epäjohdonmukainen. Siksi sen paino on pienin.

**Veden lämpötila** on tärkein tekijä, mutta sitä ei saa sääpalvelusta. Sovellus arvioi sen ilman lämpötilan 10 vuorokauden liukuvasta keskiarvosta ja tyypillisestä vuodenaikakäyrästä. Mitattu arvo (lämpömittari tai kaikuluotain) kannattaa syöttää Ennuste-välilehdelle, jolloin arvio tarkentuu selvästi.

### Mallin säätäminen omilla saaliilla

Painot ovat tiedoston `js/model.js` alussa (`WEIGHTS`) ja lajikäyrät funktiossa `scoreHour`. Saaliskirja tallentaa jokaisen saaliin hetken arvion ja sään. Kun kirjauksia on kertynyt, CSV-tiedostosta näkee, mitkä tekijät oikeasti osuivat saaliisiin, ja painoja voi säätää sen mukaan.

## Tiedostot

```
index.html             sovelluksen runko
css/app.css            ulkoasu (vaalea ja tumma teema)
js/app.js              kartta, välilehdet ja käyttöliittymä
js/model.js            kalaonni-malli
js/hotspots.js         ottipaikkojen laskenta syvyysaineistosta
js/astro.js            auringon ja kuun laskenta (kalakalenteri)
js/weather.js          sää Open-Meteosta, välimuistilla
js/shp.js, js/proj.js  shapefile-luku ja ETRS-TM35FIN-muunnos
js/store.js            laitteen tallennus (IndexedDB)
sw.js                  offline-välimuisti
tools/rajaa_syke.py    Syken aineiston rajaus data-kansioon
data/                  rajattu syvyysaineisto
```

## Lähteet ja lisenssit

- Syvyysaineisto: Suomen ympäristökeskus (Syke), CC BY 4.0.
- Taustakartat: Maanmittauslaitos, avoin rajapinta, CC BY 4.0.
- Sää: [Open-Meteo.com](https://open-meteo.com/), CC BY 4.0. Ilmainen ei-kaupalliseen käyttöön ilman API-avainta.
- Zip-purku: [fflate](https://github.com/101arrowz/fflate), MIT.
- Auringon ja kuun kaavat noudattavat SunCalc-kirjaston (BSD-2) julkaistuja menetelmiä.

Kartta ei ole navigointikartta. Tarkista kalastusluvat ja paikalliset rajoitukset (kalastusrajoitus.fi). Kuhan valtakunnallinen alamitta on 42 cm.

Valitse repositoriolle haluamasi lisenssi (esim. MIT) ennen julkaisua.
