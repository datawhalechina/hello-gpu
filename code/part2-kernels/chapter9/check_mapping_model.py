#!/usr/bin/env python3
"""CPU checks for reduction address pairs and coverage, not GPU performance."""

import unittest


VERSIONS = ("interleaved", "compacted", "sequential")
BLOCKS = (8, 32, 64, 128, 256, 512, 1024)


def rounds(version, block):
    """Each tuple is (executing thread, destination address, source address)."""
    if block < 1 or block & (block - 1):
        raise ValueError("block must be a positive power of two")
    if version not in VERSIONS:
        raise ValueError("unknown version")
    stride = block // 2 if version == "sequential" else 1
    while 0 < stride < block:
        pairs = []
        for thread in range(block):
            if version == "interleaved" and thread % (2 * stride) == 0:
                pairs.append((thread, thread, thread + stride))
            elif version == "compacted" and 2 * stride * thread < block:
                address = 2 * stride * thread
                pairs.append((thread, address, address + stride))
            elif version == "sequential" and thread < stride:
                pairs.append((thread, thread, thread + stride))
        yield pairs
        stride = stride // 2 if version == "sequential" else stride * 2


def checked_reduce(version, block, valid):
    """Track each input's identity so cancellation cannot hide lost/duplicate inputs."""
    if not 0 <= valid <= block:
        raise ValueError("valid count must fit the block")
    identities = [{index} if index < valid else set() for index in range(block)]
    values = [index + 1 if index < valid else 0 for index in range(block)]
    additions = 0
    for pairs in rounds(version, block):
        all_addresses = []
        threads = []
        for thread, left, right in pairs:
            assert 0 <= thread < block and 0 <= left < block and 0 <= right < block
            assert left != right
            assert identities[left].isdisjoint(identities[right]), "input would be counted twice"
            all_addresses.extend((left, right))
            threads.append(thread)
        assert len(threads) == len(set(threads)), "one thread assigned two pairs"
        assert len(all_addresses) == len(set(all_addresses)), "overlapping pair accesses within a round"
        # Pair accesses are disjoint in this round, so their updates may run in parallel.
        for _, left, right in pairs:
            identities[left] |= identities[right]
            values[left] += values[right]
            additions += 1
    assert identities[0] == set(range(valid)), "missing or duplicated original input"
    assert values[0] == valid * (valid + 1) // 2
    assert additions == block - 1
    return identities[0], values[0]


class MappingModelTests(unittest.TestCase):
    def test_hand_checked_eight_thread_example(self):
        self.assertEqual(list(rounds("interleaved", 8)), [
            [(0, 0, 1), (2, 2, 3), (4, 4, 5), (6, 6, 7)],
            [(0, 0, 2), (4, 4, 6)], [(0, 0, 4)],
        ])
        self.assertEqual(list(rounds("compacted", 8)), [
            [(0, 0, 1), (1, 2, 3), (2, 4, 5), (3, 6, 7)],
            [(0, 0, 2), (1, 4, 6)], [(0, 0, 4)],
        ])
        self.assertEqual(list(rounds("sequential", 8)), [
            [(0, 0, 4), (1, 1, 5), (2, 2, 6), (3, 3, 7)],
            [(0, 0, 2), (1, 1, 3)], [(0, 0, 1)],
        ])

    def test_compaction_preserves_the_data_tree(self):
        for block in BLOCKS:
            interleaved = list(rounds("interleaved", block))
            compacted = list(rounds("compacted", block))
            self.assertEqual(len(interleaved), block.bit_length() - 1)
            self.assertEqual(len(compacted), len(interleaved))
            for sparse, dense in zip(interleaved, compacted):
                self.assertEqual([(left, right) for _, left, right in sparse],
                                 [(left, right) for _, left, right in dense])
                self.assertEqual([thread for thread, _, _ in dense], list(range(len(dense))))

    def test_round_boundaries_and_input_coverage(self):
        for version in VERSIONS:
            for block in BLOCKS:
                boundary_counts = {0, 1, block // 2 - 1, block // 2, block // 2 + 1, block - 1, block}
                boundary_counts |= {count for count in (31, 32, 33, 255, 256, 257) if count <= block}
                for valid in sorted(boundary_counts):
                    with self.subTest(version=version, block=block, valid=valid):
                        checked_reduce(version, block, valid)
                self.assertEqual(len(list(rounds(version, block))), block.bit_length() - 1)

    def test_grid_tails_cover_every_global_input_once(self):
        for version in VERSIONS:
            for block in (32, 64, 256, 1024):
                for size in (1, 31, 32, 33, 255, 256, 257, 1027, 4099):
                    seen = set()
                    for start in range(0, size, block):
                        identities, _ = checked_reduce(version, block, min(block, size - start))
                        global_ids = {start + local for local in identities}
                        self.assertTrue(seen.isdisjoint(global_ids))
                        seen |= global_ids
                    self.assertEqual(seen, set(range(size)))


if __name__ == "__main__":
    unittest.main(verbosity=2)
