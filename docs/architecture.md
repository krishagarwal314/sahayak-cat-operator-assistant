# CAT Saathi - diagrams

Paste either block into https://mermaid.live to render it, or view this file on GitHub.
Rendered: [architecture](architecture-system.png), [user flow](architecture-flow.png).

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

## 2. User flow

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
