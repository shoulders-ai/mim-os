# mim-run.R — R plot-capture harness for code.run
#
# Wraps a user script so base-graphics plots land as numbered PNGs in MIM_RUN_DIR
# instead of vanishing into Rplots.pdf. Dependency-free (base R only).
#
# Invoked as: Rscript <this file> <user script>
# Expects: MIM_RUN_DIR environment variable set to the run output directory.

args <- commandArgs(trailingOnly = TRUE)
script <- args[[1]]
run_dir <- Sys.getenv("MIM_RUN_DIR")
if (nzchar(run_dir)) {
  dir.create(run_dir, recursive = TRUE, showWarnings = FALSE)
  n <- 0L
  options(device = function(...) {
    n <<- n + 1L
    grDevices::png(file.path(run_dir, sprintf("plot-%02d.png", n)),
                   width = 1600, height = 1200, res = 192)
  })
}
status <- 0L
tryCatch(
  source(script, echo = TRUE, max.deparse.length = 250),
  error = function(e) { message("Error: ", conditionMessage(e)); status <<- 1L }
)
while (grDevices::dev.cur() > 1L) grDevices::dev.off()
if (!is.null(warnings()) && length(warnings())) print(warnings())
quit(save = "no", status = status)
