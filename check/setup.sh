#!/bin/sh
# Prepares the checker: builds NodeBox 3, collects the GraalJS classpath, compiles Harness.java and
# assembles data/fixtures, the folder every module runs in.
#
#   npm run check:setup
#
# Needs JDK 21, Maven, Python 3, and the Node Library in "data/Node Library" (its sample files become
# fixtures). Everything it writes is git-ignored.
set -eu
cd "$(dirname "$0")/.."
NB3=.cache/nodebox3
# The NodeBox 3 Java sources the round 1 results were measured against.
NB3_REF=${NB3_REF:-fa44d75}
NL="data/Node Library"

if [ ! -d "$NB3/.git" ]; then
  git clone https://github.com/nodebox/nodebox "$NB3"
fi
git -C "$NB3" fetch -q origin
git -C "$NB3" -c advice.detachedHead=false checkout -q "$NB3_REF"
(cd "$NB3" && mvn -q -DskipTests compile && mvn -q dependency:build-classpath -Dmdep.outputFile=../nb3-cp.txt)
# NodeLibrary loads core.ndbx through FileUtils.getApplicationFile, which looks in resources/.
mkdir -p "$NB3/resources"
[ -e "$NB3/resources/libraries" ] || ln -s ../libraries "$NB3/resources/libraries"
(cd check && mvn -q dependency:build-classpath -Dmdep.outputFile=../.cache/graal-cp.txt)
printf '%s:%s:%s' "$(cd "$NB3" && pwd)/target/classes" "$(cat .cache/nb3-cp.txt)" "$(cat .cache/graal-cp.txt)" > .cache/cp.txt

mkdir -p .cache/harness
javac -cp "$(cat .cache/cp.txt)" -d .cache/harness check/java/Harness.java

# The working directory every module runs in. Node Library code reads its sample files from the
# document's folder or from ~/Desktop (HOME is this folder during a run), so both get a copy.
F=data/fixtures
rm -rf "$F"
mkdir -p "$F"
cp check/fixtures/* "$F/"
find "$NL" -maxdepth 1 -type f \( -name '*.svg' -o -name '*.jpg' -o -name '*.png' \) -exec cp {} "$F/" \;
mkdir -p "$F/empty folder" "$F/non-empty folder"
printf 'This is a simple text file.\n' > "$F/non-empty folder/text file.txt"
printf '<opml version="1.0"><body><outline text="One"/></body></opml>\n' > "$F/non-empty folder/outline.opml"
mkdir -p "$F/Desktop"
cp -R "$F"/* "$F/Desktop/"
rm -rf "$F/Desktop/Desktop"
mkdir -p "$F/Desktop/Node Library" "$F/Desktop/Directory Nodes/sub a" "$F/Desktop/Directory Nodes/sub b" "$F/Desktop/Gravity"
cp check/fixtures/* "$F/Desktop/Node Library/"
echo "Checker ready: .cache/cp.txt, .cache/harness, $F"
