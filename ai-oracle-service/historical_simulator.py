"""
Zaman Makinesi: Gerçek Zamanlı Sürekli Öğrenim Simülatörü
Tüm hisselerin son 3.5 yıllık verisini çeker, ilk 2 yılını modeli başlatmak için kullanır.
Kalan son 1.5 yılı gün gün (simüle ederek) modele tahmin ettirir, test eder ve Continuous Learning altyapısını hızlandırılmış olarak çalıştırır.
"""

import os, json, datetime, time
import joblib
import pandas as pd
import numpy as np
import yfinance as yf
from pathlib import Path

# Main dosyasındaki kütüphanelerden gerekli olanları dahil et
from main import (
    ALL_SYMBOLS, FEATURE_NAMES, compute_feature_df, compute_labels, LABEL_IDX, train_pipeline,
    backtest_shadow_model, update_drift_stats, check_concept_drift, _direction, get_targets,
    PRED_FILE, TRAIN_FILE, MODEL_FILE, MIN_TRAIN_ROWS, MAX_TRAIN_ROWS, RETRAIN_EVERY, UP_THRESH, DN_THRESH
)

def print_hdr(msg):
    print(f"\n{'='*60}\n{msg}\n{'='*60}")

def run_simulation():
    print_hdr("⏳ Zaman Makinesi Başlatılıyor...")
    
    # Tüm verileri önceden indirelim (Hafızada tutmak simülasyonu hızlandırır)
    print("Market verileri indiriliyor (Son 3.5 Yıl)... Bu biraz sürebilir.")
    market_data = {}
    for sym, yf_sym in ALL_SYMBOLS.items():
        try:
            df = yf.download(yf_sym, period="40mo", interval="1d", auto_adjust=True, progress=False, threads=False)
            if df is not None and not df.empty:
                df.index = pd.to_datetime(df.index).tz_localize(None)
                market_data[yf_sym] = df
                print(f"  ✓ {sym} indirildi ({len(df)} gün)")
        except Exception as e:
            print(f"  ✗ {sym} indirilemedi: {e}")
            
    if not market_data:
        print("Veri indirilemedi! Çıkılıyor.")
        return

    # Zaman Çizelgesi Belirleme
    # Ortak tarihleri bulalım
    all_dates = []
    for df in market_data.values():
        all_dates.extend(df.index.tolist())
    unique_dates = sorted(list(set(all_dates)))
    
    # İlk %60 -> Bootstrap. Son %40 -> Simülasyon
    split_idx = int(len(unique_dates) * 0.60)
    boot_dates = unique_dates[:split_idx]
    sim_dates = unique_dates[split_idx:]
    
    print_hdr(f"Zaman Çizelgesi:\nBootstrap Dönemi: {boot_dates[0].date()} -> {boot_dates[-1].date()}\nSimülasyon Dönemi: {sim_dates[0].date()} -> {sim_dates[-1].date()}\nToplam Simülasyon Günü: {len(sim_dates)}")

    # 1. Aşama: Bootstrap (Sistem Başlatılışı)
    print("Aşama 1: Bootstrap Model Kuruluyor...")
    all_X, all_y = [], []
    for sym, yf_sym in ALL_SYMBOLS.items():
        if yf_sym not in market_data: continue
        df = market_data[yf_sym].loc[:boot_dates[-1]] # Sadece geçmiş
        if len(df) < 100: continue
        
        feat_df = compute_feature_df(df)
        labels = compute_labels(df["Close"].squeeze().ffill())
        
        combined = feat_df.copy()
        combined["label"] = labels
        combined = combined.dropna()
        combined = combined[combined["label"] >= 0]
        
        if len(combined) > 0:
            all_X.append(combined[FEATURE_NAMES].values)
            all_y.append(combined["label"].astype(int).values)

    if not all_X:
        print("Bootstrap verisi oluşturulamadı.")
        return
        
    X_boot = np.vstack(all_X)
    y_boot = np.concatenate(all_y)
    
    df_train = pd.DataFrame(X_boot, columns=FEATURE_NAMES)
    df_train["label"] = y_boot
    df_train.to_csv(TRAIN_FILE, index=False)
    
    pipe = train_pipeline(X_boot, y_boot)
    update_drift_stats(X_boot)
    joblib.dump(pipe, MODEL_FILE)
    print(f"Bootstrap tamam. Model {len(y_boot)} satırla eğitildi ve kaydedildi.")
    
    # PRED_FILE'ı sıfırla
    if PRED_FILE.exists():
        os.remove(PRED_FILE)
        
    # Hafıza içi simülasyon değişkenleri
    memory_predictions = [] # (date, sym, predicted, conf, close, target)
    new_outcomes_count = 0
    total_evals = 0
    correct_evals = 0
    
    # 2. Aşama: Walk-Forward Sonrası
    print_hdr("Aşama 2: Kayan Zamanlı Simülasyon (Walk-Forward) Başlıyor...")
    
    for i, current_date in enumerate(sim_dates):
        # 2a. Doğrulama (Evaluation) — 5 gün önceki tahminlerin sonucuna bak
        eval_day_matched = False
        for p in memory_predictions:
            # p: { 'ts': date, 'sym': sym, 'yf': yf, 'pred': pred, 'close': c, 'eval': False }
            if p['eval']: continue
            
            days_passed = (current_date - p['ts']).days
            if days_passed >= 5: # 5 gün vade doldu!
                yf_sym = p['yf']
                if yf_sym not in market_data: continue
                # O günün fiyatına bak
                df_now = market_data[yf_sym].loc[:current_date]
                if df_now.empty: continue
                
                c_now = float(df_now["Close"].squeeze().iloc[-1])
                c_then = float(p['close'])
                ret = (c_now - c_then) / c_then if c_then else 0
                actual = _direction(ret)
                
                is_correct = (p['pred'] == actual)
                if is_correct: correct_evals += 1
                total_evals += 1
                
                p['eval'] = True
                p['eval_data'] = f"{actual}|{ret:.4f}"
                new_outcomes_count += 1
                eval_day_matched = True
                
                # Gerçekleşen olayı Training verisine ekle
                feat_df = compute_feature_df(df_now)
                feat_row = feat_df.iloc[-1].to_dict()
                feat_row["label"] = {"BUY": 2, "NEUTRAL": 1, "SELL": 0}.get(actual, 1)
                
                df_tr = pd.read_csv(TRAIN_FILE)
                df_tr = pd.concat([df_tr, pd.DataFrame([feat_row])], ignore_index=True)
                if len(df_tr) > MAX_TRAIN_ROWS:
                    df_tr = df_tr.iloc[-MAX_TRAIN_ROWS:]
                df_tr.to_csv(TRAIN_FILE, index=False)

        # 2b. Re-Train (Continuous Learning tetikleyicileri)
        drift_detected = False
        if eval_day_matched and TRAIN_FILE.exists():
            recent_X = pd.read_csv(TRAIN_FILE)[FEATURE_NAMES].values[-100:]
            drift_detected = check_concept_drift(recent_X)
            
        if new_outcomes_count >= RETRAIN_EVERY or drift_detected:
            reason = "Veri Sapması" if drift_detected else "Limit"
            print(f"\n[{current_date.date()}] Retrain Tetiklendi ({reason}). Yeni sonuçlar: {new_outcomes_count}")
            
            # Yeniden eğitim süreci
            df_curr_train = pd.read_csv(TRAIN_FILE)
            X_ret = df_curr_train[FEATURE_NAMES].values
            y_ret = df_curr_train["label"].astype(int).values
            shadow_pipe = train_pipeline(X_ret, y_ret)
            
            # Backtest (Son 50 tahminlik dilim)
            acc, sharpe, passed = backtest_shadow_model(shadow_pipe, df_curr_train.iloc[-200:])
            if passed:
                joblib.dump(shadow_pipe, MODEL_FILE)
                update_drift_stats(X_ret)
                pipe = shadow_pipe
                print(f"  ✓ MODEL GÜNCELLENDİ. Başarı: {acc:.1%}, Sharpe: {sharpe:.2f}")
            else:
                print(f"  ✗ MODEL REDDEDİLDİ! Eskisi korunuyor. Başarı: {acc:.1%}")
                
            new_outcomes_count = 0

        # 2c. Tahmin Üretme (Inference on Current Date)
        if len(market_data) == 0: continue
        
        preds_today = 0
        for sym, yf_sym in ALL_SYMBOLS.items():
            if yf_sym not in market_data: continue
            
            df_t = market_data[yf_sym].loc[:current_date]
            if len(df_t) < 50: continue # MA özellikleri için yeterli data yok
            
            feat_df = compute_feature_df(df_t)
            if feat_df.empty: continue
            
            feat_row_dict = feat_df.iloc[-1].to_dict()
            X_curr = feat_df[FEATURE_NAMES].iloc[-1:].values
            
            try:
                probs = pipe.predict_proba(X_curr)[0]
                pred_idx = pipe.predict(X_curr)[0]
            except:
                continue
                
            conf = float(probs[pred_idx])
            ml_label = {2: "BUY", 1: "NEUTRAL", 0: "SELL"}[pred_idx]
            
            close = float(df_t["Close"].squeeze().iloc[-1])
            st_target, _ = get_targets(feat_row_dict, close, ml_label)
            
            memory_predictions.append({
                'ts': current_date,
                'sym': sym,
                'yf': yf_sym,
                'pred': ml_label,
                'conf': conf,
                'close': close,
                'target': st_target,
                'eval': False,
                'eval_data': ''
            })
            preds_today += 1

        if i % 20 == 0:
            print(f"[{current_date.date()}] Simüle ediliyor... Toplam kayıt: {len(memory_predictions)} | Model Başarısı(Kümülatif): {(correct_evals/total_evals if total_evals>0 else 0):.1%}")
            
    # Simülasyon Bitti. Log dosyasını diske dök.
    print_hdr("Simülasyon Tamamlandı! Dosyalar Yazılıyor...")
    
    rows = []
    for p in memory_predictions:
        rows.append({
            "timestamp": p['ts'].isoformat(),
            "symbol": p['sym'],
            "yf_sym": p['yf'],
            "predicted": p['pred'],
            "confidence": round(p['conf'], 4),
            "close": p['close'],
            "target": p['target'] or 0.0,
            "eval_1d": "",
            "eval_5d": p['eval_data'] if p['eval'] else "",
            "eval_20d": "" # Simülatör sadece 5 günlüğe odaklandı
        })
        
    df_preds = pd.DataFrame(rows)
    df_preds.to_csv(PRED_FILE, index=False)
    
    print(f"Toplam Simüle Edilen Karar: {len(rows)}")
    print(f"Kümülatif Başarı: {(correct_evals/total_evals if total_evals>0 else 0):.2%}")
    print("Model günümüze hazır şekilde kuluçkadan çıkmıştır! ✓")

if __name__ == "__main__":
    run_simulation()
