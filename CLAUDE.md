# Kalakartta – siirtoyhteenveto

Tämä tiedosto kertoo seuraavalle Claudelle, mihin projekti jäi. Projekti on tehty claude.ai-keskustelussa pilvihiekkalaatikossa, jolla ei ollut pääsyä käyttäjän koneelle, Syken palvelimelle eikä GitHubiin. Siksi osa asioista on testattu vain synteettisellä datalla.

## Työtapa ja ympäristö (päivitetty 16.11.2026)

- Kehitys tehdään Claude Code -työpöytäsovelluksessa käyttäjän työkoneella (Windows, PowerShell 5.1). Käyttäjä tekee ylätason linjaukset ja vastaa kysymyksiin; Claude toteuttaa itsenäisesti.
- **Koneelle ei saa asentaa ohjelmia**: ei Gitiä, Pythonia eikä Nodea. Kaikki työkalut tehdään PowerShellillä/.NETillä.
  - `tools/rajaa_syke.ps1` korvaa Python-skriptin (sama logiikka C#:na Add-Typen kautta).
  - `tools/palvelin.ps1` on paikallinen testipalvelin (http://localhost:8000).
  - PowerShell 5.1 lukee BOMittoman .ps1:n ANSI-merkistönä: tallenna .ps1-tiedostot UTF-8 BOMilla, jos niissä on ääkkösiä.
- **GitHubiin vienti tehdään käsin selaimella** (Add file → Upload files). Claude kertoo jokaisen muutoksen jälkeen, mitkä tiedostot viedään. Selaimen kautta yksittäinen tiedosto saa olla enintään 25 Mt.
- Syken lähdepaketit (~1 Gt) ladataan väliaikaiskansioon, ei OneDrive-kansioon.

## Tarkoitus

Mobiilisovellus käyttäjän mökkivesille Kymijoen vesistössä (Iitin Pyhäjärvi, Pelinginselkä, Marlebäck–Hiidensaari, Kymijoki Iitistä Jaalaan, Mankalan voimalaitos Kaurakoskessa). Kohdelajit: kuha, ahven, hauki ja kirjolohi. Sovellus julkaistaan GitHub Pagesiin ja asennetaan puhelimeen PWA:na.

Toiminnot:
- Syvyyskartta Syken avoimesta syvyysaineistosta; napautus näyttää syvyyden.
- Kalapaikat: omat paikat ja 10 valmista ehdotusta, jotka käyttäjä sijoittaa kartalle.
- Ennuste: tuntikohtainen arvio 0–100 per laji kymmeneksi päiväksi, viikon parhaat ajat, Mihin mennä -vinkit.
- Saaliskirja: saaliiseen tallentuu sää, paine ja mallin arvio; CSV-vienti. Tarkoitus on kalibroida mallia omilla saaliilla.

Käyttöliittymä on suomeksi.

## Päätökset ja perustelut

- **PWA eikä natiivisovellus.** Ei sovelluskauppaa, ilmainen julkaisu GitHub Pagesissa, toimii iOS:llä ja Androidilla.
- **Ei taustapalvelinta eikä build-vaihetta.** Puhtaat ES-moduulit; kaikki käyttäjädata (paikat, saaliit, laitteelle ladatut tasot) IndexedDB:ssä. Seuraus: data ei synkronoidu laitteiden välillä (ks. avoimet).
- **Syke eikä Maanmittauslaitos.** Syke julkaisee valmiit koko maan paketit (CC BY 4.0, ETRS-TM35FIN): syvyysalue.zip, syvyyskayra.zip (päivitetty 4.10.2016), luotauspisteet.zip (28.3.2017), lisäksi ranta10jarvet.zip ja ranta10joet.zip. Osoitteet: `https://wwwd3.ymparisto.fi/d3/gis_data/spesific/<nimi>.zip`. MML:n maastotietokannan syvyyskäyrät olisivat karttalehtikohtaisia ja työläämpiä.
- **Aineisto rajataan valmiiksi repoon.** `tools/rajaa_syke.py` rajaa zipit Iitti–Jaala-alueelle ja kirjoittaa `data/*.json` + `data/layers.json`, jolloin kaikki laitteet saavat aineiston. Selaimessa rajaus on vaihtoehtona (Aineisto-välilehti), mutta koko maan paketit voivat olla puhelimelle liian isoja.
- **Oma canvas-piirto, ei taustakarttaa.** Alkuperäinen versio oli claude.ai-artefakti, jonka CSP esti ulkoiset karttatiilet. GitHub Pagesissa tätä rajoitusta ei ole, joten taustakartan lisääminen on nyt mahdollista (ks. seuraavat askeleet).
- **Koordinaatit.** Kaikki tallennettu sijainti on absoluuttisena ETRS-TM35FIN:nä (E, N). Piirto käyttää kiinteää nollapistettä `ORIGIN = [453000, 6742500]` liukulukutarkkuuden takia. Rajausalue `REGION_DEFAULT = [453000, 6742500, 490000, 6778000]` vaikuttaa vain rajaukseen, ei tallennettuihin sijainteihin. WGS84-muunnos on omaa koodia (Krügerin sarjat), tarkistettu pyprojia vastaan millimetrin tarkkuudella.
- **Sää Open-Meteosta.** Ilmainen, ei API-avainta, CORS sallittu. Haku: `past_days=14&forecast_days=10&timeformat=unixtime&timezone=GMT&wind_speed_unit=ms`, muuttujat temperature_2m, pressure_msl, cloud_cover, wind_speed_10m, wind_gusts_10m, wind_direction_10m, precipitation, weather_code. Unix-ajat valittiin, jotta kesäaikasiirtymät eivät sotke tunteja. Välimuisti localStoragessa 1 h.
- **Ennustemalli on läpinäkyvä sääntömalli, ei opetettu.** Jokainen tekijä 0–1, painotettu keskiarvo venytetään 0–100 kaavalla `(mean*mult − 0.38)/(0.95 − 0.38)`. Painot (`js/model.js`, `WEIGHTS`): vesi 25, valo 25, paine 12, tuuli 10, sade 10, kalakalenteri 8, istutus 15 (vain kirjolohi, vain jos istutuspäivä syötetty). Perustelut:
  - Veden lämpötila ja valo painavat eniten, koska niiden vaikutus lajien aktiivisuuteen on vahvin.
  - Ilmanpaineella pieni paino: kalastajakokemus korostaa paineen muutosta, mutta kontrolloiduissa tutkimuksissa suoraa vaikutusta ei ole juuri löydetty. Mallissa ratkaisee 3 h ja 24 h muutos, ei taso.
  - Kalakalenteri (solunaariteoria) pienimmällä painolla, koska tutkimusnäyttö on heikkoa; käyttäjä halusi sen mukaan.
  - Veden lämpötilaa ei saa sääpalvelusta: arvio = 50 % ilman lämpötilan 10 vrk EMA + 50 % tyypillinen vuodenaikakäyrä (`climWater`). Käyttäjä voi syöttää mitatun arvon (voimassa ±4 vrk).
  - Lajikäyrät: kuha paras 16–24 °C ja hämärässä; ahven 15–22 °C, päivällä, huiput aamupäivä ja ilta; hauki 12–19 °C, päivällä, aamu ja ilta; kirjolohi 11–16 °C, huono yli 20 °C, hämärässä.
  - Kutuajat (kuha, ahven, hauki) ja jääaika näkyvät huomioina; kuhan kutuaikana kerroin 0,85, hauen 0,9.
- **Kirjolohi.** Käyttäjän mukaan kirjolohta on istutettu Mankalan voimalaitoksen edustalle ja sieltä saadaan hyvin. Lisättiin ehdotettu paikka 10 ja istutustekijä (paras 3–21 vrk istutuksesta, laskee ~60 vrk:ssa).
- **Ehdotetut paikat 1–9** on arvioitu käyttäjän kahdesta MML-pohjaisen karttasovelluksen kuvakaappauksesta (syvyyspisteet ja -käyrät). Niillä ei ole koordinaatteja, siksi käyttäjä sijoittaa ne itse oikean syvyysaineiston päälle.
- **Ulkoasu.** Barlow + Barlow Condensed, syvyyssiniset sävyt, teal-korostus, vaalea ja tumma teema CSS-muuttujina. Lajivärit CSS-muuttujissa (`--kuha`, `--ahven`, `--hauki`, `--kirjolohi`, `--molemmat`, `--muu`).

## Ottipaikat (lisätty 16.11.2026)

Käyttäjän määrittely: kartan "Lisää ottipaikat" -nappi avaa lajivalikon; valittujen lajien parhaat paikat lasketaan *nykyiselle karttanäkymälle*. Lajit erivärisillä pallukoilla; jokaisella oma numero, joka näkyy vasta lähelle zoomattaessa. Numerointi aina ylhäältä alas ja vasemmalta oikealle (yhteinen kaikille lajeille). Paikat-välilehti listaa ja kuvaa jokaisen pallukan; napautus kartalla näyttää saman kuvauksen. Omien paikkojen lisäys siirtyi Paikat-välilehden "Lisää oma paikka" -napiksi.

Toteutus (`js/hotspots.js`): näkymä jaetaan soluihin (15–150 m), vesi-, virta- (vesitasot, joiden nimessä "joki") ja syvyysalueet rasteroidaan piilotetulle canvasille, luotauspisteet keskiarvotetaan soluihin. Syvyys: luotaukset > lähimmät luotaukset (~40 m) > syvyysalueen keskikohta. Tunnusluvut: jyrkkyys (m/100 m), matalikko (ympäröivä rengas ~120 m syvempi), syvänne ~150 m säteellä, etäisyys rantaan, virta. Tavoitesyvyys lajeittain veden lämpötilan ja kuukauden mukaan (`seasonDepth`). Pelkkä sopiva syvyys antaa enintään 0,35 → paikalla on oltava rakenne; kynnys 0,45. Enintään 8 paikkaa/laji, väli vähintään max(120 m, näkymä/9). Tallennetaan localStorageen (`hot`, `hotPick`). Veden lämpötila = nykyhetken arvio (`waterTemp`).

Rajoitukset: ei tietoa pohjan laadusta, kasvillisuudesta eikä virran voimakkuudesta; kirjolohi = virta-alueet (Mankalaa ei tunnisteta erikseen).

## MML:n taustakartta (lisätty 16.11.2026)

Avoin WMTS: `https://avoin-karttakuva.maanmittauslaitos.fi/avoin/wmts/1.0.0/{taso}/default/ETRS-TM35FIN/{z}/{rivi}/{sarake}.png?api-key=…` (ortokuva .jpg). Tasot: maastokartta, taustakartta, selkokartta, ortokuva. ETRS-TM35FIN: vasen yläkulma (-548576, 8388608), 256 px, taso z = 2^(13−z) m/px, avoimessa palvelussa tasot 0–13. Sama koordinaatisto kuin sovelluksella, joten muunnosta ei tarvita.
- API-avain on käyttäjän päätöksellä (16.11.2026) koodissa: `js/config.js` (`MML_KEY`), julkisesti nähtävissä. Aineisto-välilehdellä voi asettaa laitekohtaisen oman avaimen (localStorage `mmlKey`), tyhjä palauttaa oletusavaimen. Avaimen hankinta: omatili.maanmittauslaitos.fi → avoimet rajapintapalvelut → luo API-avain.
- MML kuvaa avoimen rajapinnan testaukseen ja pienimuotoiseen käyttöön (ruuhkassa 503, ei takuuta). Jos käyttäjiä tulee paljon, harkitse sopimuspohjaista palvelua tai käyttäjäkohtaisia avaimia.
- Taustan valinta Tasot-valikossa (`bg`). Kun tiiliä näkyy, omat vesialueet jätetään piirtämättä ja syvyysalueet piirretään läpikuultavina. Jos tiilet eivät lataudu, piirto palaa entiseen.
- Tiilet ladataan `crossOrigin=anonymous` (MML palauttaa CORS-otsakkeet ainakin 401-vastauksessa); virheessä yritetään kerran ilman CORSia. Väärä avain → 403 ilman CORS-otsakkeita.
- Service worker tallentaa tiilet erilliseen välimuistiin `kalakartta-tiilet` (välimuisti ensin, max 6000 tiiltä), joten katsotut alueet toimivat ilman verkkoa.
- Testattu oikealla avaimella 16.11.2026: tiilet latautuvat CORS-tilassa ilman virheitä ja osuvat Syken syvyysalueiden ja rantaviivojen kanssa yksiin. Service workerin tiilivälimuistia ei ole testattu (SW ei rekisteröidy Clauden selaimessa).

## Tekninen rakenne

```
index.html            runko: kartta + alapaneeli (Ennuste, Paikat, Saaliit, Aineisto)
css/app.css           ulkoasu, teemat
js/app.js             kartta (canvas, pan/pinch/zoom, Path2D-välimuisti), UI, saaliit, aineiston tuonti, GPS, käynnistys
js/model.js           scoreHour(laji, t, ctx), whereToGo, waterTemp, climWater, WEIGHTS
js/hotspots.js        ottipaikat: findHotspots (rasteroi näkymän syvyysaineiston, pisteyttää lajeittain), seasonDepth
js/astro.js           auringon ja kuun korkeus, nousu/lasku, kulminaatiot, kuun vaihe, solunaarijaksot
js/weather.js         getWeather (Open-Meteo + välimuisti), hourAt
js/shp.js             shapefile- ja dbf-lukija, bbox-rajaus, yksinkertaistus (CORE.processShapefile)
js/proj.js            TM.fwd(lon,lat) / TM.inv(E,N)
js/store.js           LS (localStorage) ja IDB (stores: layers, spots, catches)
sw.js                 offline-välimuisti; versio VERSION-vakiossa, nosta aina kun tiedostot muuttuvat
tools/rajaa_syke.py   pyshp-pohjainen rajaus; --bbox, --min-step, --kind nimi=tyyppi, --depth nimi=KENTTÄ[,KENTTÄ2]
data/layers.json      { "layers": [ {id, file, kind, name, depthField, depthField2} ] }, nyt tyhjä
```

Tasotiedoston muoto (`data/<id>.json`): `{v:1, kind, name, origin:[E0,N0], features:[{t:"A"|"L"|"P", p:{syvyyskentät}, r:[[x0,y0,x1,y1,…], …]}]}`, koordinaatit kokonaislukumetreinä suhteessa `origin`-pisteeseen. Tason tyypit: `alueet`, `kayrat`, `pisteet`, `vesi`.

Paikka: `{id, n, name, sp, note, E, N, sug?}`. Saalis: `{id, sp, t, len, wt, lure, note, spotId, place, E, N, ilma, paine, paine3h, tuuli, suunta, pilvi, sade, vesi, arvio}`.

Ulkoiset riippuvuudet: fflate 0.8.2 (jsDelivr UMD, zip-purku), Google Fonts. Molemmat välimuistissa service workerin kautta ensimmäisen latauksen jälkeen.

## Testattu ja testaamatta

Testattu (Playwright, Chromium, mobiili- ja työpöytäkoko, vaalea ja tumma teema): synteettiset shapefilet (rajaus, tyyppien ja kenttien arvaus, piirto, syvyyslukema), python-skripti samoilla tiedostoilla, ennuste simuloidulla Open-Meteo-vastauksella kaikille neljälle lajille, istutustekijä, saaliin tallennus. Auringon ja kuun ajat tarkistettu ephemiä vastaan: auringonnousu ±4–11 min, kuunnousu/-lasku ±6–15 min.

16.11.2026 oikealla aineistolla: Syken paketit rajattu `rajaa_syke.ps1`:llä (data/ ~30 Mt, 6 tasoa), kartta ja syvyysalueet piirtyvät, oikea Open-Meteo-haku toimii (paikallinen palvelin, Clauden selain). Syken havainnot:
- Syvyysalueen syvyys on tekstikentässä `Syvyysvali` ("0-1,5", "1,5-3", …) ja käyrän `Syvyyskayr`-kentässä tekstinä. Rajaus muuntaa ne numeerisiksi kentiksi `syv_min`/`syv_max`.
- Luotauspisteiden syvyys: `Syvyys_m` (numeerinen).
- Rantaviivat: `Jarvi10` (järvet), `JokiAlue10` (jokialueet), `JokiViiva10` (kapeat joet viivoina) → tyyppi `vesi`.
- Kattavuus: Iitin Pyhäjärvi (14.121.1.004) on luodattu, 220 syvyysaluetta. Lisäksi ~350 syvyysaluetta ilman järvitunnusta (todennäköisesti Kymijoen osuudet). Konnivedellä ei ole syvyysaineistoa.

Ei testattu: GitHub Pages -julkaisu, service worker (rekisteröinti epäonnistui Clauden sisäisessä selaimessa, todennäköisesti selainympäristön rajoitus), oikea puhelin, GPS iOS:n kotivalikkotilassa, Kaurakosken ja Pelinginselän kattavuus silmämääräisesti.

## Avoimet ongelmat ja riskit

1. **Syken kenttänimet ovat tuntemattomia.** Syvyyskentät arvataan nimen perusteella (min/max, SYV, DRVAL). Tarkista skriptin tuloste ja korjaa tarvittaessa `layers.json` tai käytä `--depth`.
2. **Kattavuus tuntematon.** Ei ole varmistettu, onko Pelinginselkä, Iitin Pyhäjärvi tai Kaurakoski luodattu Syken aineistossa. Aineisto on vuosilta 2016–2017.
3. **Datan varmuuskopio.** Paikat ja saaliit ovat vain laitteen IndexedDB:ssä. Saaliit saa CSV:nä, paikkoja ei voi viedä eikä tuoda. Selaimen tietojen tyhjennys hävittää ne.
4. **Taustakartta puuttuu.** Ilman rantaviivatasoja kartalla näkyy vain syvyysalueet.
5. **Kirjolohen virtapaikka.** Mankalan juoksutus vaikuttaa syöntiin, mutta virtaamatietoa ei ole mallissa. Kaurakosken lupa-alue ja virtapaikan säännöt on tarkistamatta.
6. **Veden lämpötila on karkea arvio**, vaikka se on mallin painavin tekijä.
7. **Aikavyöhyke.** Ennusteen päivät ja tunnit lasketaan laitteen paikallisessa ajassa; olettaa laitteen olevan Suomen ajassa.
8. **Mallin painot ovat arvioita**, eikä niitä ole kalibroitu saalisdatalla.
9. Repolle ei ole valittu lisenssiä.
10. claude.ai:ssa on erillinen, vanhempi artefaktiversio kartasta (vain kuha ja ahven, ilman ennustetta). Se ei ole synkronissa tämän repon kanssa.

## Seuraavat askeleet

1. ~~Syken aineiston rajaus~~ tehty 16.11.2026.
2. ~~Paikallinen testi~~ tehty 16.11.2026 (`tools/palvelin.ps1`).
3. Valitse lisenssi, vie GitHubiin selaimella, ota GitHub Pages käyttöön (main, juuri). Nosta `sw.js`:n `VERSION` aina kun tiedostot muuttuvat (nyt v6).
4. Käyttäjä asentaa sovelluksen puhelimeen, sijoittaa ehdotetut paikat ja syöttää Mankalan viimeisimmän istutuspäivän.
5. Suunnitellut parannukset tärkeysjärjestyksessä:
   - paikkojen ja saaliiden vienti ja tuonti JSON-tiedostona (varmuuskopio ja laitteiden välinen siirto)
   - taustakartta (esim. MML:n avoin taustakartta tai OpenStreetMap; tarkista käyttöehdot ja mahdollinen API-avain)
   - selvitä, saako Kymijoen virtaaman tai veden lämpötilan Syken avoimista rajapinnoista; jos saa, lisää virtaama kirjolohen tekijäksi ja korvaa veden lämpötila-arvio
   - mallin kalibrointi saaliskirjan perusteella, kun kirjauksia on kertynyt
   - lupa- ja rajoitustiedot Kaurakoskesta ja Natura-alueilta sovelluksen huomioihin
