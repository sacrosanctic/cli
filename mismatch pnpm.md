# install pnpm v11

cd ~
pn -v
11.22.0

git clone https://github.com/sveltejs/cli
pn -v
10.33.4

pn build
pn sv create ../foo --template minimal --types ts --install pnpm --add eslint

cat ../foo/pnpm-workspace.yaml
onlyBuiltDependencies:

- esbuild
