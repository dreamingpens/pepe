- **Problem and motivation**
  - Recurrent models’ sequential computation prevents parallelization within training examples. [p. 2](paper://page/2#line=p2-l4)
  - Transformer replaces recurrence and convolutions with attention-based sequence modeling. [p. 2](paper://page/2#line=p2-l37)
  - Self-attention offers constant-length paths for learning long-range dependencies. [p. 6](paper://page/6#line=p6-l41)

- **Architecture**
  - Encoder and decoder each contain six stacked layers. [p. 3](paper://page/3#line=p3-l3) [p. 3](paper://page/3#line=p3-l10)
  - Layers combine attention with position-wise feed-forward networks and residual normalization. [p. 3](paper://page/3#line=p3-l3)
  - Decoder cross-attention accesses representations from all input positions. [p. 5](paper://page/5#line=p5-l24)
  - Masked decoder self-attention prevents access to future output tokens. [p. 3](paper://page/3#line=p3-l13)

- **Attention and position**
  - Dot-product attention scales query–key scores by $1/\sqrt{d_k}$ before softmax. [p. 4](paper://page/4#line=p4-l6)
    - Here, $d_k$ denotes the dimensionality of queries and keys. [p. 4](paper://page/4#line=p4-l7)
  - Eight attention heads jointly capture information from different representation subspaces. [p. 5](paper://page/5#line=p5-l1) [p. 5](paper://page/5#line=p5-l19)
  - Sinusoidal positional encodings add sequence-order information to token embeddings. [p. 6](paper://page/6#line=p6-l13)

- **Training and findings**
  - Base training took 12 hours on eight NVIDIA P100 GPUs. [p. 7](paper://page/7#line=p7-l26)
  - Big-model training took 3.5 days on the same hardware. [p. 7](paper://page/7#line=p7-l26)
  - English–German achieved 28.4 BLEU, exceeding previous best results by over 2.0. [p. 8](paper://page/8#line=p8-l28)
    - The comparison includes previously reported ensemble models. [p. 8](paper://page/8#line=p8-l29)
  - Semi-supervised English constituency parsing achieved 92.7 F1 on WSJ Section 23. [p. 9](paper://page/9#line=p9-l47) [p. 9](paper://page/9#line=p9-l60)

- **Qualifications and limitations**
  - English–French scores conflict: Table 2 reports 41.8, prose reports 41.0 BLEU. [p. 8](paper://page/8#line=p8-l23) [p. 8](paper://page/8#line=p8-l34)
  - Full self-attention has quadratic complexity in sequence length. [p. 6](paper://page/6#line=p6-l1)
    - Restricted attention for very long sequences remains future work. [p. 6](paper://page/6#line=p6-l54) [p. 7](paper://page/7#line=p7-l1)
  - Output generation remains autoregressive despite greater training parallelism. [p. 2](paper://page/2#line=p2-l45)
  - Sinusoidal extrapolation beyond training lengths is hypothesized, not demonstrated. [p. 6](paper://page/6#line=p6-l29)
