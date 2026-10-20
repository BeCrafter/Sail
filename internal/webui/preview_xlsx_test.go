package webui_test

import (
	"os/exec"
	"path/filepath"
	"testing"
)

// XLSX 预览的公式计算是纯前端逻辑;有 node 时用内置 ExcelJS 跑一遍冒烟脚本,
// 没有 node 的开发机/CI 自动跳过,不阻塞 Go 门禁。
func TestXlsxFormulaEvaluation(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node not found; skip xlsx formula smoke test")
	}
	cmd := exec.Command(node, filepath.Join("testdata", "preview_xlsx_test.mjs"))
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("xlsx 公式测试失败: %v\n%s", err, out)
	}
	t.Logf("%s", out)
}
