package cmd

import (
	"errors"
	"fmt"
	"net"
	"strconv"
	"syscall"

	"github.com/BeCrafter/sail/internal/i18n"
)

// listenProbeAttempts 是端口被占用时最多向后探测多少个端口。20 足够覆盖
// 「本机还开着几个别的 sail 实例」的常见情况,又不至于悄悄跑到一个完全
// 无关的端口。
const listenProbeAttempts = 20

// listenWithProbe 绑定 addr;端口被占用时从原端口开始逐个向后探测,直到
// 找到一个能绑定的端口。返回实际监听器与实际地址——调用方必须用后者打印
// 横幅和生成 URL,否则用户会拿到一个不存在的端口。
//
// 显式配置的端口也参与探测:启动横幅会把「原端口被占用,改用 X」说清楚;
// 刻意不做「显式 flag 就 fail-loud」的分叉,否则默认端口被占时零配置启动
// 又回到不可用状态。
func listenWithProbe(addr string) (net.Listener, string, error) {
	host, portStr, err := net.SplitHostPort(addr)
	if err != nil {
		return nil, "", fmt.Errorf(i18n.T("invalid listen address %q: %w"), addr, err)
	}
	port, err := strconv.Atoi(portStr)
	if err != nil || port < 0 || port > 65535 {
		return nil, "", fmt.Errorf(i18n.T("invalid listen port %q"), portStr)
	}
	// 端口 0 = 交给内核分配,没有「被占用」可言。
	if port == 0 {
		ln, err := net.Listen("tcp", addr)
		if err != nil {
			return nil, "", err
		}
		return ln, ln.Addr().String(), nil
	}

	var lastErr error
	for i := 0; i < listenProbeAttempts && port+i <= 65535; i++ {
		candidate := net.JoinHostPort(host, strconv.Itoa(port+i))
		ln, err := net.Listen("tcp", candidate)
		if err == nil {
			return ln, candidate, nil
		}
		lastErr = err
		if !isAddrInUse(err) {
			return nil, "", err
		}
	}
	return nil, "", fmt.Errorf(i18n.T("could not bind %s (tried %d ports): %w"), addr, listenProbeAttempts, lastErr)
}

// isAddrInUse 判断绑定失败是否只是「端口被占用」。其它错误(权限、地址不存在)
// 不该被探测掩盖。
func isAddrInUse(err error) bool {
	return errors.Is(err, syscall.EADDRINUSE)
}
