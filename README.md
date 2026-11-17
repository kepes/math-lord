# Math Lord

VR matekjáték gyerekeknek, böngészőben (WebXR). Egy sziklatorony tetején állsz; a távoli felhőn
megjelenik a feladat (pl. `3 + 2 = ?`), alulról öt számozott doboz száll fel lufikon. A helyes
eredményt kell a karddal szétvágni.

- Rossz dobozt vágsz szét, vagy mind elszáll: hiba, leomlik a torony egy darabja.
- Három hiba után az egész torony leomlik, és lezuhansz.
- Nehézség: 5 jó válaszig 10-es számkör, további 10 jó válaszig 100-as, utána 1000-es. A nagyobb
  számkörben is jönnek könnyebb feladatok.
- A műveletek (összeadás, kivonás, szorzás, osztás) a kezdőlapon külön ki-be kapcsolhatók.
- Szemüveg nélkül is játszható: kattints vagy koppints a helyes dobozra.

## Irányítás a szemüvegben

- A kard a jobb kezedben van; lendítsd át a dobozon vagy a lufiján.
- A ravasz indítja a játékot. Játék közben a másik kéz ravasza átveszi a kardot.

## Fejlesztés

```bash
npm install
npm run dev            # fejlesztői szerver
npm test               # a feladatgenerátor tesztjei
npm run build:single   # dist-single.html: egyetlen fájl, bármilyen HTTPS tárhelyre
npm run smoke          # végigjátszás emulált Quest 3-mal (Playwright kell hozzá)
```
