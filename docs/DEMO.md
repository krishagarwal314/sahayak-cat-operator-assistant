# Demo script

About six minutes. Built around one idea: **an operator who cannot read the
screen can still use every part of it.**

## Before you start

```bash
git pull && bash scripts/demo.sh      # rebuilds the UI, checks every model
bash scripts/share.sh                 # or Lightning's own port sharing
```

Enrol your own face once before presenting (step 1 below), so the live login
is instant.

---

## 1. Face login (45s)

Tap the big yellow button. That one tap unlocks both the camera and the voice.

The first time, nobody is enrolled, so it asks you to tap your photo. Tap
**रमेश कुमार** and hold still: three dots fill in as it saves your face.
It then goes straight back to scanning — look at the camera and it logs you in
with a green tick and "नमस्ते रमेश कुमार".

> "यहाँ कोई पासवर्ड नहीं है। ऑपरेटर बस कैमरे में देखता है। चेहरा पहचानने में कुछ मिलीसेकंड लगते हैं, और तस्वीर कहीं सेव नहीं होती, सिर्फ़ चेहरे का गणितीय निशान।"

Point out: no camera, or not recognised? Tap your own photo. Nobody gets locked out.

## 2. Every screen talks (30s)

Each screen says one line when it opens — where you are and what to do. Not
the content, just orientation. The small speaker at the top says it again.

> "जो पढ़ नहीं सकता, वह भी कभी खोता नहीं है।"

## 3. Today's work (45s)

Press **पूरा काम सुनें**. The manager wrote the tasks in English; the operator
hears them in Hindi, slowly, with numbers spoken as words.

Each task is a picture of the job, its time and its place. Tap **कैसे करें**
on the trench task.

## 4. Picture guide (75s) — the strongest moment

One step per screen: a huge picture, three words, a slow voice saying
"कदम एक…". Press the green **आगे** button.

Go to step 2, **नीचे रिसाव देखिए** — the whole screen turns red with
**सावधान!** Safety steps can't be missed.

Turn on **अपने आप** (hands-free): it moves to the next step by itself after
each one is spoken, so both hands can stay on the controls.

## 5. The machine (60s)

**मशीन** tab. Say **"एक्सकेवेटर चुनो"** into the yellow mic, or tap its picture.

One verdict at the top — *4 बातों पर ध्यान दें* — then six big tiles. Tap
the fuel tile: it speaks the answer.

Then hold the mic and ask **"मशीन में कोई खराबी है क्या"**.

## 6. Machine context (45s)

Switch to the loader and ask **"हाइड्रोलिक तेल का तापमान बताओ"**. It says,
in Hindi, that this machine has no such sensor — instead of inventing a number.

## 7. Safety (30s)

Two big cards: seatbelt, and whether anyone is nearby. The big red button
reports an accident by voice — hold, speak, confirm, sent.

## 8. For the judges: the engineering (30s)

The chart icon in the top bar opens the supervisor view: full telemetry, the
routing trace under every answer, and **LLM calls: 0**.

---

## If something goes wrong

| Problem | What to do |
|---|---|
| Camera does nothing | Must be the `https://` link. Or tap your photo to log in. |
| Not recognised | Tap **नया चेहरा जोड़ें** and enrol again in better light. |
| No voice | Browser speech takes over automatically. Check laptop volume. |
| Still see the old screens | Run `bash scripts/demo.sh` again — it rebuilds the UI. |
