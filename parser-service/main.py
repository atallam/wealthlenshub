from fastapi import FastAPI, File, UploadFile, HTTPException, Form
from fastapi.middleware.cors import CORSMiddleware
import casparser
import io
import os
from supabase import create_client, Client

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

@app.get("/")
async def root():
    return {"status": "WealthLens Parser is Online"}

@app.post("/api/parse")
async def parse_document(
    file: UploadFile = File(...),
    pan: str = Form(...),
    user_id: str = Form(...)
):
    try:
        file_content = await file.read()
        data = casparser.read_cas_pdf(io.BytesIO(file_content), pan)
        
        extracted_assets = []
        for folio in data.get("folios", []):
            for scheme in folio.get("schemes", []):
                val = scheme.get("valuation", 0)
                if val > 0:
                    asset = {
                        "user_id": user_id,
                        "name": scheme.get("scheme"),
                        "valuation": float(val),
                        "type": "IN_MF",
                        "category": "Indian Market",
                        "metadata": {
                            "folio": folio.get("folio"),
                            "units": scheme.get("units"),
                            "nav": scheme.get("nav")
                        }
                    }
                    extracted_assets.append(asset)

        supabase.table("assets").delete().eq("user_id", user_id).eq("type", "IN_MF").execute()
        if extracted_assets:
            supabase.table("assets").insert(extracted_assets).execute()
        
        return {"message": "Sync successful", "count": len(extracted_assets)}

    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))