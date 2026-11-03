import pathlib
import sys
source = pathlib.Path(sys.argv[1]).read_text()
assert ')MERLINJS"' not in source
pathlib.Path(sys.argv[2]).write_text('inline constexpr char kCosmeticHelper[] = R"MERLINJS(' + source + ')MERLINJS";\n')
