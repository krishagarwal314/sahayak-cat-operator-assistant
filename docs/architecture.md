# CAT Saathi - diagrams

Paste either block into https://mermaid.live to render it, or view this file on GitHub.
Rendered: [architecture](architecture-system.png), [architecture with models](architecture-detailed.png), [user flow](architecture-flow.png).

## 1. Architecture

```mermaid
flowchart LR
    OP["Operator<br/>face, voice, taps"]
    APP["CAT Saathi app<br/>pictures + voice"]
    SIC["Speech Intent Classifier<br/>self-trained, Whisper encoder"]
    ML["ML models<br/>Safety risk: Gradient Boosting<br/>Task time: Gradient Boosting<br/>Unusual use: Isolation Forest"]
    DATA[("Machine telemetry<br/>+ past jobs")]
    TTS["Voice reply<br/>Hindi / English TTS"]
    MGR["Manager portal"]

    OP --> APP --> SIC --> TTS --> OP
    DATA --> ML --> APP
    ML --> MGR
```

## 2. Architecture, with the model at each step

```mermaid
flowchart LR
    subgraph IN["1. Who and what"]
        CAM["Camera"] --> FACE["Face login<br/>YuNet + SFace"]
        MIC["Mic"] --> SIC["Speech Intent Classifier<br/>Whisper-small Hindi encoder<br/>+ MLP head, self-trained"]
    end

    subgraph THINK["2. Answer"]
        CTX["Machine filter<br/>only this machine's questions"]
        ANS["Answer builder<br/>Hindi + English"]
    end

    subgraph ML["3. ML models on telemetry"]
        TEL[("Telemetry<br/>+ past jobs")]
        RISK["Safety risk<br/>Gradient Boosting Classifier"]
        TIME["Task time<br/>Gradient Boosting Regressor"]
        UNU["Unusual use<br/>Isolation Forest"]
    end

    subgraph OUT["4. Voice out"]
        TTS["Text to speech<br/>MMS-TTS Hindi, VITS English"]
        CACHE[("Audio cache")]
        SPK["Speaker"]
    end

    FACE --> ANS
    SIC --> CTX --> ANS
    TEL --> RISK & TIME & UNU
    RISK & TIME & UNU --> ANS
    ANS --> TTS --> SPK
    TTS <--> CACHE
```

## 3. User flow

```mermaid
flowchart TD
    A["Face login"] --> B["Today's work<br/>read aloud"]
    B --> C["Choose machine<br/>tap or say it"]
    C --> D["Safety check<br/>read first"]
    D --> E["Machine page<br/>fuel, health, video"]
    E --> F["Report<br/>ML safety signals"]
    E --> G["Learn<br/>guides, book a trainer"]
    E --> H["Ask by voice<br/>tap, speak, tap"]
    H --> I["Spoken answer"]
```
