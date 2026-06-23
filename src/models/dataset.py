"""
PyTorch Dataset and DataLoader factory for possession sequences.
"""

import sys
from pathlib import Path

import numpy as np
import torch
from torch.utils.data import DataLoader, Dataset

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from src.features.encode_possessions import load_split_tensors, MAX_SEQ_LEN, N_FEATURES


class PossessionDataset(Dataset):
    def __init__(self, X: np.ndarray, lengths: np.ndarray, y: np.ndarray):
        self.X = torch.from_numpy(X)            # (N, T, F)
        self.lengths = torch.from_numpy(lengths)  # (N,)
        self.y = torch.from_numpy(y)            # (N,)

    def __len__(self):
        return len(self.y)

    def __getitem__(self, idx):
        return self.X[idx], self.lengths[idx], self.y[idx]


def make_dataloader(split: str, batch_size: int = 256, shuffle: bool = True) -> DataLoader:
    X, lengths, y, _ = load_split_tensors(split, MAX_SEQ_LEN)
    ds = PossessionDataset(X, lengths, y)
    return DataLoader(ds, batch_size=batch_size, shuffle=shuffle, num_workers=0)
