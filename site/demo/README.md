# Illustrative search-order fixture

Four synthetic files, six matching lines, one query. It demonstrates hay's reading-order
mechanism; it is not a benchmark or evidence of general retrieval quality. Both complete outputs
are retained in expected-hay.txt and expected-rg.txt. The landing build renders those files.

Run `bash site/check-demo.sh` from the repository after building hay and installing ripgrep.
The exact invocations, run from fixture/, are:

```sh
rg --hidden --no-ignore-global --no-ignore-exclude --no-ignore-dot -g '!.git' -g '!.git/**' --sort path -n -F -e validateSession .
hay --hidden -g '!.git' -g '!.git/**' -n -F -e validateSession .
```

hay already disables global, exclude and dot ignore inputs. Hidden/glob/matching flags have
counterparts on both sides. Path separators and CRLF are normalized for the Windows fixture;
no line, match or order is removed. Each real binary must exit 0. The check compares both exact
ordered outputs and their complete match sets. All six results appear in the website.
