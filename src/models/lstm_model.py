"""
GRU-based sequence classifier for P(shot | possession).

Architecture:
  - Per-event feature vector (event type OHE + play pattern OHE + zone OHE + 6 continuous)
  - Projection layer (linear, no activation)
  - 2-layer GRU with dropout
  - Final linear layer -> sigmoid

The model uses pack_padded_sequence for efficient variable-length handling.
"""

import torch
import torch.nn as nn
from torch.nn.utils.rnn import pack_padded_sequence


class PossessionGRU(nn.Module):
    def __init__(
        self,
        input_size: int,
        hidden_size: int = 128,
        num_layers: int = 2,
        dropout: float = 0.3,
        proj_size: int = 64,
    ):
        super().__init__()
        self.proj = nn.Linear(input_size, proj_size)
        self.gru = nn.GRU(
            input_size=proj_size,
            hidden_size=hidden_size,
            num_layers=num_layers,
            batch_first=True,
            dropout=dropout if num_layers > 1 else 0.0,
        )
        self.drop = nn.Dropout(dropout)
        self.head = nn.Linear(hidden_size, 1)

    def forward(self, x: torch.Tensor, lengths: torch.Tensor) -> torch.Tensor:
        """
        x       : (B, T, F) padded sequence
        lengths : (B,) true sequence lengths (on CPU)
        returns : (B,) raw logits
        """
        x = self.proj(x)

        packed = pack_padded_sequence(
            x, lengths.cpu(), batch_first=True, enforce_sorted=False
        )
        _, h_n = self.gru(packed)
        # h_n: (num_layers, B, hidden_size) — take last layer
        out = h_n[-1]  # (B, hidden_size)
        out = self.drop(out)
        logits = self.head(out).squeeze(-1)  # (B,)
        return logits
