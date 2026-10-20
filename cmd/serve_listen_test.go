package cmd

import (
	"net"
	"strconv"
	"testing"
)

// 端口被占用时向后探测:返回的监听器必须真的能连,端口在原端口之后。
func TestListenWithProbeMovesToFreePort(t *testing.T) {
	busy, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("占位监听失败: %v", err)
	}
	defer busy.Close()
	port := busy.Addr().(*net.TCPAddr).Port

	ln, addr, err := listenWithProbe(net.JoinHostPort("127.0.0.1", strconv.Itoa(port)))
	if err != nil {
		t.Fatalf("探测空闲端口失败: %v", err)
	}
	defer ln.Close()

	host, portStr, err := net.SplitHostPort(addr)
	if err != nil {
		t.Fatalf("返回地址不合法: %v", err)
	}
	if host != "127.0.0.1" {
		t.Errorf("返回地址 host = %q,期望 127.0.0.1", host)
	}
	got, _ := strconv.Atoi(portStr)
	if got <= port || got > port+listenProbeAttempts {
		t.Errorf("探测结果端口 = %d,期望落在 %d..%d", got, port+1, port+listenProbeAttempts)
	}
	conn, err := net.Dial("tcp", addr)
	if err != nil {
		t.Fatalf("探测结果无法连接: %v", err)
	}
	conn.Close()
}

// 端口 0 交给内核分配:返回实际地址,而不是字面上的 :0。
func TestListenWithProbePortZero(t *testing.T) {
	ln, addr, err := listenWithProbe("127.0.0.1:0")
	if err != nil {
		t.Fatalf("端口 0 绑定失败: %v", err)
	}
	defer ln.Close()
	_, portStr, err := net.SplitHostPort(addr)
	if err != nil {
		t.Fatalf("返回地址不合法: %v", err)
	}
	if portStr == "0" || portStr == "" {
		t.Errorf("端口 0 应返回内核分配的实际端口,得到 %q", addr)
	}
}

func TestListenWithProbeRejectsInvalidAddress(t *testing.T) {
	for _, addr := range []string{"no-port", "127.0.0.1:not-a-port", "127.0.0.1:70000"} {
		if _, _, err := listenWithProbe(addr); err == nil {
			t.Errorf("%q 应被拒绝", addr)
		}
	}
}
