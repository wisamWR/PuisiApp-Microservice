# T7.3 - Similarity Evaluation Dataset

## Dataset Source
- Name: Poetry Greats - Public Domain
- Repository: https://huggingface.co/datasets/yoonholee/poetry-greats-public-domain
- Original text source: Project Gutenberg
- License: CC0 1.0 Universal
- Language: English
- File: sources/poetry-greats-public-domain.parquet

## Evaluation Purpose
This dataset is used as the source of public-domain poems for evaluating
the similarity detection system.

## Evaluation Data
The evaluation dataset will contain at least 100 labeled poem pairs:
- Original / unrelated
- Inspired
- Paraphrased
- Partial copy
- Full copy

## Notes
Variations created from source poems are synthetic evaluation samples.
Expected labels must be assigned before running the evaluation.
