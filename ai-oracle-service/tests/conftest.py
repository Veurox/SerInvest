"""
SerInvest — pytest ortak kurulum.

docs/SAGLAMLIK_PLANI.md Katman 3. Kural: testler DİSKE ve AĞA dokunmaz.
Gerçek ml_data/ dosyalarını okuyan/yazan bir test, hem yavaş hem de canlı
veriyi bozabilir. Dosya gerektiren testler tmp_path kullanır.
"""
import sys
from pathlib import Path

# ai-oracle-service kökünü import yoluna al (tests/ bir alt dizin).
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
