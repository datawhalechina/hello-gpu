# Chapter 8 walkthrough evidence

This publication contains a new measured run. `summary.csv` uses benchmark
samples only: 50 event samples per process, then the median of three process
medians and their min/max range. It does not pool processes or use event values
printed while profiling. `profile-summary.csv` has a separate kernel-trace scope.

`configs/<id>/benchmark-p1.stdout.log` is one process's stdout, so its median need
not equal the three-process summary. `profile.stdout.log` and `profile.stderr.log` preserve
the two captured profiler streams separately, including warnings. An empty
stderr file means that the captured stream was empty, not that it was omitted.
`inspect.stdout.log` is the inspector output captured on the experiment host and
checked again against the complete CSV in each config's `profile/` before publication.
If collection needed a retry, `failed-*` retains the failed attempt's captured
streams; the standard `profile.*.log` and selected trace refer to the successful
attempt. Recorded failures are never used as benchmark or trace measurements.
Small profiler statistics CSVs are included when emitted. Full HIP API traces
and Perfetto files remain in the local raw run; their hashes remain in the raw
manifest records. The recorded profiler commands can regenerate those files.

Only explicitly supplied private path prefixes are normalized in terminal and
command files. No lines, timings, timestamps or resource values are removed or
rewritten. `manifest.json` records both original and published file hashes and
the replacement labels (the private originals themselves are represented by
hashes). Frozen source bytes and trace CSVs are preserved without normalization.

The VitePress page can import these tracked files directly. It does not require
the ignored local `results/` directory to build. This exporter does not run GPU
experiments; reproducing the measurements still requires the documented host.
