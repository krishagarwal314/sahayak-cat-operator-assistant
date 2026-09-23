# Demo script (Hindi)

Roughly six minutes. Everything below is copy-paste ready.

## Before you start

```bash
cd backend
.venv/bin/python scripts/download_models.py      # once, ahead of time
EAGER_LOAD_MODELS=1 .venv/bin/python -m uvicorn app.main:app --port 8000
```

`EAGER_LOAD_MODELS=1` loads the models at boot so the first question of the demo
is not the slow one. Alternatively press **Warm up models** on the Insights page.

Reset between run-throughs: `POST /api/system/reset`, or the language toggle and
a browser refresh are usually enough.

Check the mic works in the browser before you present — Chrome only allows
microphone access on `localhost` or over HTTPS.

---

## 1. Login (20s)

Sign in as `OP1001 / cat1234` — Ramesh Kumar, day shift, Pit B.

> "ऑपरेटर अपनी आईडी से लॉगिन करता है। पूरा इंटरफ़ेस हिंदी में है, और ऊपर से कभी भी अंग्रेज़ी में बदला जा सकता है।"

Toggle **हिंदी / EN** once in the header to show the whole UI flip, then switch back.

---

## 2. Shift briefing (60s)

Three tasks. The manager wrote them in English; the operator sees Hindi.

Press the big speaker button.

> "मैनेजर ने काम अंग्रेज़ी में लिखा था। ऑपरेटर उसे अपनी भाषा में सुन रहा है — अनुवाद मॉडल से, और मशीन का नाम, जगह, समय सब सही हिंदी में।"

Open task 1 to show the instructions, the safety note about the buried cable, and
the estimate chips.

> "यह समय अनुमान तय नहीं है। यह पिछले चार सौ बीस पूरे हो चुके कामों से निकाला गया है — मौसम, ज़मीन, शिफ्ट और ऑपरेटर के अनुभव को देखकर।"

---

## 3. Machine selection by voice (40s)

Go to **मशीनें**. Hold the mic and say:

> **"एक्सकेवेटर चुनो"**

It transcribes, classifies as `SWITCH_MACHINE`, extracts the machine slot, and
opens the cockpit.

---

## 4. The cockpit (2 min)

Hold the mic and ask, one at a time:

| Say this | What to point out |
|---|---|
| **"कितना ईंधन बचा है"** | Answers percent, litres *and* how long it lasts at the current burn rate |
| **"मशीन में कोई खराबी है क्या"** | Rolls up every sensor, names the most important finding, with the diesel and rupees idling wasted |
| **"यह काम कितनी देर में पूरा होगा"** | Range, finish time, and the conditions that moved it |
| **"सीट बेल्ट लगी है क्या"** | Now tap the seatbelt panel to unfasten it and ask again — the answer and the safety score both change |

After any answer, expand the small strip under it:

> "यहाँ दिखता है कि जवाब किस चरण पर तय हुआ और कितने मिलीसेकंड लगे। ज़्यादातर सवाल पहले ही चरण पर, एक मिलीसेकंड से भी कम में हल हो जाते हैं। किसी भी एलएलएम को कॉल नहीं गया।"

Then tap a quick-question chip:

> "बटन दबाने पर इरादा पहले से पता है, इसलिए वर्गीकरण की ज़रूरत ही नहीं पड़ती। वही सवाल बोलकर पूछें तो पूरा राउटर चलता है।"

---

## 5. Machine context — the key moment (60s)

Header → machine chip → pick the **CAT 950 Loader**. Ask the same question:

> **"कितना ईंधन बचा है"**

Different machine, different number. Then ask something the loader does not have:

> **"हाइड्रोलिक तेल का तापमान बताओ"**

> "लोडर पर यह सेंसर है ही नहीं। सहायक अंदाज़ा नहीं लगाता, साफ़ कह देता है कि यह जानकारी इस मशीन पर उपलब्ध नहीं है, और बताता है कि क्या पूछा जा सकता है।"

Ask the loader something only it has:

> **"बकेट में कितना वज़न है"**

---

## 6. Insights (40s)

> "एक ही इंटरफ़ेस, हर मशीन के लिए अलग संदर्भ। सारे सवाल स्थानीय रूप से हल हुए, औसत समय एक-दो मिलीसेकंड, और एलएलएम कॉल शून्य।"

Show the stage distribution and the model panel.

---

## Extra questions that work

```
आज कितनी देर मशीन खाली चली
अगला काम क्या है
सर्विस कब होनी है
आज कितने लोड साइकिल हुए
क्या आसपास कोई है
मुझे ट्रेनिंग चाहिए
पूरे दिन का हिसाब दो
मौसम कैसा है
इंजन कितना गरम है
मुझे एक घटना दर्ज करनी है
```

Romanised Hinglish works too: `fuel kitna bacha hai`, `machine me koi problem hai kya`.

---

## If something goes wrong

| Problem | What to do |
|---|---|
| Mic does nothing | Check the browser permission. The app automatically falls back to the browser's own recogniser if the server STT model is missing — press and speak again. |
| No audio comes back | The browser's speech synthesis takes over automatically. Nothing to do. |
| Answers feel slow on the first question | The model was loading. Press **Warm up models** on Insights before presenting. |
| Everything is in English | Language toggle in the header. |
| Want a clean slate | `curl -X POST localhost:8000/api/system/reset -H "Authorization: Bearer <token>"` |
