<!-- Python 3.12.10 -->
python -m venv .venv
.\.venv\Scripts\Activate
python -m pip install --upgrade pip
python.exe -m pip install --upgrade pip setuptools wheel
pip install nvidia-cublas-cu12 nvidia-cudnn-cu12 nvidia-cuda-runtime-cu12  ( For Cuda Download)
pip install -r requirements.txt
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu124

backend\.venv\Scripts\python.exe -c "from torchreid.reid.utils.feature_extractor import FeatureExtractor; FeatureExtractor(model_name='osnet_x0_25', device='cpu'); print('torchreid OK')"


<!-- TO RUN: -->
python dev_server.py api --api-workers 1
python dev_server.py stream --stream-workers 1 --startup-delay 5


<!-- TRAINING MODELS: -->
 python backend/app/ml/training/train_ppe.py


 <!-- For Admin Creation Script -->
 python -m app.scripts.seed_admin



<!-- TESTING: run from backend/ directory -->
<!-- Run tests (terminal output only inside test directory) -->
.run_tests.bat
