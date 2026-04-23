require "markdown_site"
require "fileutils"

site = MarkdownSite::Site.new("./logseq.toml", :logseq)
site.init_publish_dir

assets_dir = site.config.assets_dir
if Dir.exist?(assets_dir)
  FileUtils.rm_rf(File.join(site.config.publish_dir, assets_dir))
  FileUtils.cp_r(assets_dir, File.join(site.config.publish_dir, assets_dir))
end

site.config.copy_files.each do |file|
  FileUtils.cp(file, File.join(site.config.publish_dir, file)) if File.file?(file)
end

site.write_data_json
site.generate
