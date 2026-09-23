# CAT Saathi - architecture

Paste either block into https://mermaid.live to render it, or view this file on GitHub.
Rendered: [system](architecture-system.png), [models](architecture-models.png).

## 1. System

```mermaid
flowchart LR
    subgraph DEVICE["Operator phone / cab tablet - React PWA"]
        CAM["Camera<br/>face login"]
        MIC["Tap-to-talk mic"]
        UI["Picture UI<br/>Simple view / Standard view"]
        SPK["Speaker"]
    end

    subgraph API["FastAPI server - GPU"]
        FACE["Face login<br/>YuNet detector + SFace embedder<br/>OpenCV"]
        SLU["Speech Intent Classifier - self-trained<br/>audio in, intent out, no transcript<br/>Whisper-small Hindi encoder<br/>+ attentive pooling + 2-layer MLP<br/>13 intents + out-of-scope"]
        CTX["Machine-context filter<br/>only intents this machine supports"]
        GEN["Answer builder<br/>live telemetry to Hindi / English sentence"]
        TTS["Text to speech<br/>Hindi: facebook/mms-tts-hin VITS<br/>English: kakao-enterprise/vits-ljs + espeak-ng"]
        CACHE[("Speech cache<br/>memory LRU + disk WAV<br/>warmed at startup")]
    end

    subgraph ML["Small ML models - scikit-learn, CPU, retrained in seconds"]
        RISK["Safety-risk model<br/>GradientBoostingClassifier<br/>200 trees, depth 2<br/>P of safety alert next hour"]
        TIME["Task-time model<br/>GradientBoostingRegressor<br/>+ 7% / 93% quantile models"]
        UNU["Unusual-use model<br/>IsolationForest, 300 trees<br/>+ Huber expected-fuel fit"]
        TREND["Trend forecasts<br/>least squares, last 30 min<br/>engine heat, fuel run-out"]
    end

    subgraph DATA["Data"]
        TEL[("Hourly telemetry<br/>Timestamp, Machine ID, Operator ID,<br/>Engine Hours, Fuel Used, Load Cycles,<br/>Idling Time, Seatbelt, Safety Alert")]
        HIST[("Past jobs<br/>1500 tasks + weather + soil")]
        INC[("Incident log")]
        GUIDE[("Machine guides + official Cat videos")]
    end

    subgraph OUT["What people see"]
        REP["Operator machine report<br/>one picture card per model signal"]
        MGR["Manager portal<br/>assign work, fleet risk, bookings"]
    end

    CAM --> FACE --> UI
    MIC -- "16 kHz audio" --> SLU --> CTX --> GEN --> TTS --> SPK
    TTS <--> CACHE
    TEL --> RISK & UNU & TREND
    HIST --> TIME
    RISK & TIME & UNU & TREND --> GEN
    RISK & TIME & UNU & TREND --> REP
    RISK & UNU --> MGR
    INC --> RISK
    GUIDE --> UI
    REP --> UI
```

## 2. The models and the signals they produce

```mermaid
flowchart TB
    subgraph IN["Inputs, per hour"]
        F1["Minutes since break, hours into shift"]
        F2["Ambient temp, weather: dust / rain / heat"]
        F3["Seatbelt status, proximity events, alerts so far today"]
        F4["Fuel used, load cycles, idling minutes, engine temp"]
        F5["Task type, quantity, soil, operator experience"]
    end

    RISK["Safety-risk model<br/>GradientBoostingClassifier<br/>tested on unseen days: AUC 0.82 vs 0.64 rule"]
    UNU["Unusual-use model<br/>IsolationForest + Huber fuel fit<br/>precision 73% vs 21% thresholds"]
    TIME["Task-time model<br/>GradientBoostingRegressor + quantiles<br/>error 10 min vs 24 min baseline"]
    TREND["Trend forecast<br/>least squares"]

    F1 & F2 & F3 & F4 --> RISK
    F4 --> UNU
    F5 --> TIME
    F4 --> TREND

    RISK --> S1["Risk next hour"]
    RISK --> S2["Tiredness - take a break"]
    RISK --> S3["Seatbelt lapses"]
    RISK --> S4["People nearby / poor visibility"]
    RISK --> S5["Heat stress"]
    UNU --> S6["Unusual use: leak, theft, revving idle, unlogged running"]
    UNU --> S7["Idle waste in litres and rupees"]
    UNU --> S8["Driving style score"]
    TIME --> S9["Job time left, with range"]
    TREND --> S10["Engine overheating in N minutes"]
    TREND --> S11["Diesel lasts N hours"]

    S1 & S2 & S3 & S4 & S5 & S6 & S7 & S8 & S9 & S10 & S11 --> CARD["One picture card each<br/>red first, tap to hear<br/>Hindi and English"]
```
