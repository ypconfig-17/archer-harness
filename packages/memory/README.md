# @archer/memory

导出 `memoryProvider({ directory, namespace }, id?)`，提供 append/get/search Tool 和 context 推理准备 Contract。目录必须是绝对路径，命名空间必须显式指定。

Provider 交由 `createCamp({ providers })` 初始化和释放。Tool 由 Runtime 投影；context 需要宿主通过 Archer.preparations 显式选择，不自动执行。
