#!/usr/bin/env python3
"""
Copix Core — GPU LoRA fine-tune (8GB-friendly).

Reality check (VRAM):
  gpt-oss-20b BF16 LoRA   ~44GB
  gpt-oss-20b Unsloth QLoRA ~14GB minimum
  This machine's RTX 5060 Laptop: ~8GB → cannot train gpt-oss-20b.

On <14GB VRAM we train Qwen2.5-Coder-3B-Instruct with 4-bit QLoRA on the GPU,
then export as Ollama `copix-core`. Use untuned `gpt-oss:20b` in Ollama for the
full 20B base model when you want it.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import traceback
from pathlib import Path

os.environ.setdefault("PYTHONUNBUFFERED", "1")
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(line_buffering=True)
    except Exception:
        pass

ROOT = Path(__file__).resolve().parent
OUT_DIR = ROOT / "output"
STATUS_PATH = OUT_DIR / "training_status.json"
DATA_PATH = ROOT / "data" / "train.jsonl"

# 8GB path (fits RTX 5060 Laptop)
SMALL_MODEL = "Qwen/Qwen2.5-Coder-3B-Instruct"
LORA_DIR = OUT_DIR / "copix-core-lora"
MERGED_DIR = OUT_DIR / "copix-core-merged"

# Documented minimums for gpt-oss — we refuse rather than CPU/disk-offload crash
GPT_OSS_MODEL = "openai/gpt-oss-20b"
GPT_OSS_MIN_VRAM_GB = 14.0
MAX_LENGTH = 1024

history: list[dict] = []


def write_status(data: dict) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    STATUS_PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")


def classify_error(exc: BaseException, *, failed_step: str = "training", base_model: str = "") -> dict[str, str]:
    detail = str(exc).strip()
    name = type(exc).__name__
    low = detail.lower()

    if "out of memory" in low or "cuda out of memory" in low:
        return {
            "error_type": "CudaOutOfMemoryError",
            "failed_step": failed_step,
            "message": (
                "GPU ran out of memory. Close other GPU apps (games, Ollama GPU models, browsers), "
                "then re-run. On 8GB, training uses 4-bit QLoRA with batch size 1."
            ),
            "detail": detail,
        }
    if name == "ImportError" or "no module named" in low:
        return {
            "error_type": "MissingDependencyError",
            "failed_step": "loading_model",
            "message": f"Missing Python package ({detail}). Run: powershell -ExecutionPolicy Bypass -File setup.ps1",
            "detail": detail,
        }
    return {
        "error_type": name,
        "failed_step": failed_step,
        "message": detail or name,
        "detail": detail,
        "base_model": base_model,
    }


def write_error_status(exc: BaseException, *, failed_step: str = "training", base_model: str = "") -> None:
    write_status({
        "status": "error",
        "history": history,
        "base_model": base_model,
        **classify_error(exc, failed_step=failed_step, base_model=base_model),
    })


def log(msg: str) -> None:
    print(msg, flush=True)


def gpu_vram_gb(torch) -> float | None:
    if not torch.cuda.is_available():
        return None
    return torch.cuda.get_device_properties(0).total_memory / (1024**3)


def format_messages(row: dict) -> list[dict]:
    inst = row.get("instruction", "")
    inp = row.get("input", "")
    out = row.get("output", "")
    user = inst if not inp else f"{inst}\n\nContext:\n{inp}"
    return [
        {
            "role": "system",
            "content": (
                "You are Copix Core, an expert coding agent in a Cursor-like IDE. "
                "Give high-quality explanations, write production code, and use tools proactively "
                "(read_file, edit_file, write_file, grep, list_dir, run_terminal, create_project). "
                "Prefer small focused changes. Never invent paths — verify first. "
                "Never use API keys or secrets as filenames. "
                "For Administrator tasks, use run_terminal with elevate=true."
            ),
        },
        {"role": "user", "content": user},
        {"role": "assistant", "content": out},
    ]


def load_qlora_model(torch, model_id: str):
    from transformers import AutoModelForCausalLM, BitsAndBytesConfig

    log(f"      Loading {model_id} in 4-bit (NF4) on GPU…")
    bnb = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16,
        bnb_4bit_use_double_quant=True,
    )
    model = AutoModelForCausalLM.from_pretrained(
        model_id,
        quantization_config=bnb,
        device_map={"": 0},
        trust_remote_code=True,
        use_cache=False,
    )
    return model


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=int, default=3)
    ap.add_argument("--batch-size", type=int, default=1)
    ap.add_argument("--lr", type=float, default=2e-4)
    ap.add_argument("--rank", type=int, default=16)
    ap.add_argument("--force-gpt-oss", action="store_true", help="Attempt gpt-oss (needs ≥14GB VRAM)")
    ap.add_argument("--load-only", action="store_true")
    args = ap.parse_args()

    log("=" * 56)
    log("Copix Core — GPU fine-tuning (LoRA / QLoRA)")
    log("=" * 56)

    if not DATA_PATH.exists() and not args.load_only:
        msg = "Dataset missing. Run: py -3.11 scripts/build_dataset.py"
        write_status({
            "status": "error", "message": msg, "error_type": "DatasetMissingError",
            "failed_step": "building_dataset", "detail": msg,
        })
        print(f"ERROR: {msg}", file=sys.stderr, flush=True)
        sys.exit(1)

    try:
        import torch
        from datasets import Dataset
        from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
        from transformers import (
            AutoTokenizer,
            DataCollatorForLanguageModeling,
            Trainer,
            TrainingArguments,
            TrainerCallback,
        )
    except ImportError as e:
        write_error_status(e, failed_step="installing_deps")
        print(f"ERROR: {e}", file=sys.stderr, flush=True)
        sys.exit(1)

    cuda = torch.cuda.is_available()
    vram = gpu_vram_gb(torch)
    log(f"CUDA: {cuda}" + (f" — {torch.cuda.get_device_name(0)}" if cuda else ""))
    if vram is not None:
        log(f"VRAM: {vram:.1f} GiB")

    if not cuda:
        msg = "No CUDA GPU. Copix Core training requires an NVIDIA GPU."
        write_status({"status": "error", "message": msg, "error_type": "NoCudaError", "failed_step": "loading_model"})
        print(f"ERROR: {msg}", file=sys.stderr, flush=True)
        sys.exit(1)

    try:
        cap = torch.cuda.get_device_capability(0)
        log(f"GPU capability: sm_{cap[0]}{cap[1]}")
        _ = torch.zeros(1, device="cuda")
        log("GPU tensor test: OK")
    except Exception as e:
        write_error_status(e, failed_step="loading_model")
        print(f"ERROR: {e}", file=sys.stderr, flush=True)
        sys.exit(1)

    # Pick base model for this GPU
    if args.force_gpt_oss or (vram is not None and vram >= GPT_OSS_MIN_VRAM_GB):
        if vram is not None and vram < GPT_OSS_MIN_VRAM_GB:
            msg = (
                f"gpt-oss-20b fine-tuning needs ≥{GPT_OSS_MIN_VRAM_GB:.0f}GB VRAM "
                f"(Unsloth QLoRA) or ~44GB (BF16). This GPU has {vram:.1f}GB. "
                "Re-run without --force-gpt-oss to train Qwen2.5-Coder-3B on GPU instead."
            )
            write_status({
                "status": "error", "error_type": "InsufficientVramError",
                "failed_step": "loading_model", "message": msg, "detail": msg,
                "base_model": GPT_OSS_MODEL,
            })
            print(f"ERROR: {msg}", file=sys.stderr, flush=True)
            sys.exit(1)
        # Reserved for machines with enough VRAM — still not implemented without Unsloth.
        msg = (
            "gpt-oss-20b GPU training needs the Unsloth stack (≥14GB VRAM). "
            "This Copix build trains Qwen2.5-Coder-3B-Instruct QLoRA on 8–12GB GPUs. "
            "Remove --force-gpt-oss to continue."
        )
        write_status({
            "status": "error", "error_type": "GptOssNotConfiguredError",
            "failed_step": "loading_model", "message": msg, "detail": msg,
            "base_model": GPT_OSS_MODEL,
        })
        print(f"ERROR: {msg}", file=sys.stderr, flush=True)
        sys.exit(1)

    base_model = SMALL_MODEL
    log(f"\nNOTE: gpt-oss-20b needs ≥{GPT_OSS_MIN_VRAM_GB:.0f}GB VRAM to fine-tune.")
    log(f"      This GPU has {vram:.1f}GB → training {base_model} (4-bit QLoRA) on GPU.")
    log("      Chat with untuned gpt-oss:20b in Ollama when you want the 20B base.\n")

    rows = []
    if DATA_PATH.exists():
        rows = [json.loads(l) for l in DATA_PATH.read_text(encoding="utf-8").splitlines() if l.strip()]
        log(f"Dataset: {len(rows)} samples")

    write_status({
        "status": "running", "epoch": 0, "total_epochs": args.epochs,
        "step": 0, "total_steps": 0, "loss": None,
        "message": f"Loading {base_model} (4-bit QLoRA on GPU)…",
        "history": [], "base_model": base_model,
    })
    log(f"[1/3] Loading tokenizer + model: {base_model}")

    tokenizer = AutoTokenizer.from_pretrained(base_model, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    try:
        model = load_qlora_model(torch, base_model)
        model = prepare_model_for_kbit_training(model)
    except Exception as e:
        write_error_status(e, failed_step="loading_model", base_model=base_model)
        print(traceback.format_exc(), file=sys.stderr, flush=True)
        sys.exit(1)
    log("[1/3] Base model loaded on GPU.")

    if args.load_only:
        log("\n✓ Load-only smoke test passed.\n")
        write_status({"status": "completed", "message": "Load-only smoke test passed", "base_model": base_model})
        return

    log(f"\n[2/3] Applying LoRA (rank={args.rank})…")
    lora = LoraConfig(
        r=args.rank,
        lora_alpha=32,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
        lora_dropout=0.05,
        bias="none",
        task_type="CAUSAL_LM",
    )
    model = get_peft_model(model, lora)
    model.print_trainable_parameters()
    model.gradient_checkpointing_enable()

    texts = []
    for row in rows:
        msgs = format_messages(row)
        texts.append(tokenizer.apply_chat_template(msgs, tokenize=False, add_generation_prompt=False))

    ds = Dataset.from_dict({"text": texts})

    def tokenize(batch):
        enc = tokenizer(
            batch["text"],
            truncation=True,
            max_length=MAX_LENGTH,
            padding="max_length",
        )
        enc["labels"] = [ids[:] for ids in enc["input_ids"]]
        return enc

    ds = ds.map(tokenize, batched=True, remove_columns=["text"])

    steps_per_epoch = max(1, len(ds) // max(1, args.batch_size))
    total_steps = max(1, (steps_per_epoch // 4) * args.epochs)
    total_epochs = args.epochs
    log(f"[2/3] Ready — {len(ds)} examples, ~{total_steps} optimizer steps, max_length={MAX_LENGTH}.\n")

    class CB(TrainerCallback):
        def on_train_begin(self, ta, state, control, **kw):
            log(f">>> Training {total_epochs} epochs on GPU <<<\n")
            write_status({
                "status": "running", "epoch": 0, "total_epochs": total_epochs,
                "step": 0, "total_steps": total_steps, "loss": None,
                "message": "Training started (GPU QLoRA)", "history": history, "base_model": base_model,
            })

        def on_log(self, ta, state, control, logs=None, **kw):
            if not logs:
                return
            loss = logs.get("loss")
            epoch = int(state.epoch or 0)
            step = state.global_step
            if loss is not None and epoch >= 1:
                entry = {"epoch": epoch, "loss": round(float(loss), 4)}
                if not history or history[-1]["epoch"] != epoch:
                    history.append(entry)
                    log(f"  Epoch {epoch}/{total_epochs}  step {step}/{total_steps}  loss={loss:.4f}")
            write_status({
                "status": "running", "epoch": epoch, "total_epochs": total_epochs,
                "step": step, "total_steps": total_steps,
                "loss": round(float(loss), 4) if loss is not None else None,
                "message": f"Epoch {epoch}/{total_epochs}" + (f" · loss {loss:.4f}" if loss else ""),
                "history": history, "base_model": base_model,
            })

    use_bf16 = torch.cuda.is_bf16_supported()
    training_args = TrainingArguments(
        output_dir=str(LORA_DIR),
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size,
        gradient_accumulation_steps=4,
        learning_rate=args.lr,
        logging_steps=1,
        save_strategy="epoch",
        bf16=use_bf16,
        fp16=not use_bf16,
        gradient_checkpointing=True,
        report_to="none",
        optim="paged_adamw_8bit",
        warmup_steps=max(1, int(total_steps * 0.05)),
        dataloader_pin_memory=True,
    )

    collator = DataCollatorForLanguageModeling(tokenizer=tokenizer, mlm=False)
    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=ds,
        data_collator=collator,
        callbacks=[CB()],
    )
    log("[3/3] Training on GPU…\n")

    try:
        trainer.train()
        log("\nSaving LoRA adapter…")
        model.save_pretrained(LORA_DIR)
        tokenizer.save_pretrained(LORA_DIR)

        log("Merging LoRA into base for Ollama export…")
        # 4-bit trained adapters must be merged onto an FP16/BF16 base (not the quant weights).
        del model
        del trainer
        import gc
        gc.collect()
        torch.cuda.empty_cache()

        from peft import PeftModel
        from transformers import AutoModelForCausalLM

        dtype = torch.bfloat16 if use_bf16 else torch.float16
        base = AutoModelForCausalLM.from_pretrained(
            base_model,
            dtype=dtype,
            device_map="cpu",
            trust_remote_code=True,
        )
        peft_model = PeftModel.from_pretrained(base, str(LORA_DIR))
        merged = peft_model.merge_and_unload()
        MERGED_DIR.mkdir(parents=True, exist_ok=True)
        merged.save_pretrained(MERGED_DIR)
        tokenizer.save_pretrained(MERGED_DIR)

        msg = f"Tuning complete. LoRA: {LORA_DIR}  Merged: {MERGED_DIR}"
        log(f"\n✓ {msg}\n")
        write_status({
            "status": "completed", "epoch": args.epochs, "total_epochs": args.epochs,
            "step": total_steps, "total_steps": total_steps,
            "loss": history[-1]["loss"] if history else None,
            "message": msg, "history": history,
            "adapter_path": str(LORA_DIR),
            "merged_path": str(MERGED_DIR),
            "base_model": base_model,
        })
    except Exception as e:
        print(traceback.format_exc(), file=sys.stderr, flush=True)
        write_error_status(e, failed_step="training", base_model=base_model)
        sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(traceback.format_exc(), file=sys.stderr, flush=True)
        write_error_status(e, failed_step="loading_model")
        sys.exit(1)
